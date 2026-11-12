import { afterEach, describe, expect, it, vi } from 'vitest'
import { anthropicAdapter, buildAnthropicRequest } from './providers/anthropic'
import { responsesAdapter, buildResponsesRequest } from './providers/responses'
import { chatCompletionsAdapter, buildChatRequest } from './providers/chatCompletions'
import { geminiAdapter, buildGeminiRequest } from './providers/gemini'
import { SteerQueue, steerNotes } from './steering'
import { settleActivity, activityTitle } from './activity'
import { buildProviderInput, plainTurns, type ProviderRequestContext } from './core'
import type { ActivityStep, BrowserToolName, HistoryMessage } from '../types/index.js'

const base = (overrides: Partial<ProviderRequestContext> = {}): ProviderRequestContext => ({
  model: 'test-model',
  apiKey: 'key',
  baseURL: 'https://example.test/v1',
  input: [{ role: 'user', content: 'Tell me about cats' }],
  params: {},
  tools: {},
  callbacks: {},
  provideAbort: () => {},
  ...overrides,
})

const json = (body: unknown) => new Response(JSON.stringify(body))
const lines = (events: unknown[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
const sse = (...events: unknown[]) => new Response(lines(events))
const bodyOf = (fetcher: ReturnType<typeof vi.fn>, call: number) => JSON.parse((fetcher.mock.calls[call]![1] as RequestInit).body as string)

/** A stream that sends `events`, then stays open until the request is aborted. */
function openStream(init: RequestInit | undefined, ...events: unknown[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines(events)))
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))
    },
  }))
}

const steerSteps = (steps: ActivityStep[] | undefined) => (steps ?? []).filter(step => step.kind === 'steer')

afterEach(() => vi.unstubAllGlobals())

describe('steering at a tool boundary', () => {
  const toolUse = {
    content: [
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_current_time', input: {} },
    ],
    stop_reason: 'tool_use',
  }

  it('Anthropic: sends the message as text after every tool_result', async () => {
    const steering = new SteerQueue()
    const fetcher = vi.fn()
      // Arrives while the first request is answering: it waits for the tool result.
      .mockImplementationOnce(async () => { steering.push('Use 24-hour time'); return json(toolUse) })
      .mockResolvedValueOnce(json({ content: [{ type: 'text', text: 'It is 12:00.' }], stop_reason: 'end_turn' }))
    vi.stubGlobal('fetch', fetcher)
    const reply = await anthropicAdapter.respond(base({ model: 'claude-opus-5-5', tools: { browserTools: ['clock'] as BrowserToolName[] }, steering }), false)

    const answer = bodyOf(fetcher, 1).messages.at(-1)
    expect(answer.role).toBe('user')
    expect(answer.content.map((block: { type: string }) => block.type)).toEqual(['tool_result', 'text'])
    expect(answer.content[1]).toEqual({ type: 'text', text: 'Use 24-hour time' })
    expect(reply.text).toBe('Let me check.\n\nIt is 12:00.')
    expect(steerSteps(reply.activity)).toEqual([expect.objectContaining({ status: 'done', text: 'Use 24-hour time', at: 'Let me check.'.length })])
    // The steered turn is part of the stored reply.
    expect((reply.native?.data as { messages: unknown[] }).messages).toHaveLength(3)
  })

  it('Anthropic: holds the message while a server tool call is still open', async () => {
    const steering = new SteerQueue()
    const withServerCall = {
      content: [
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'cats' } },
        { type: 'tool_use', id: 'toolu_1', name: 'get_current_time', input: {} },
      ],
      stop_reason: 'tool_use',
    }
    const fetcher = vi.fn()
      .mockImplementationOnce(async () => { steering.push('Shorter please'); return json(withServerCall) })
      .mockResolvedValueOnce(json({ content: [{ type: 'text', text: 'Cats.' }], stop_reason: 'end_turn' }))
      .mockResolvedValueOnce(json({ content: [{ type: 'text', text: 'Short cats.' }], stop_reason: 'end_turn' }))
    vi.stubGlobal('fetch', fetcher)
    const reply = await anthropicAdapter.respond(base({
      model: 'claude-opus-5-5',
      tools: { browserTools: ['clock'] as BrowserToolName[], webSearch: { enabled: true } },
      steering,
    }), false)

    // Tool results alone answer the open call...
    expect(bodyOf(fetcher, 1).messages.at(-1).content.map((block: { type: string }) => block.type)).toEqual(['tool_result'])
    // ...and the message continues the reply once it is finished.
    expect(bodyOf(fetcher, 2).messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: 'Shorter please' }] })
    expect(reply.text).toBe('Cats.\n\nShort cats.')
  })

  it('Gemini: sends the message as a text part after the function responses', async () => {
    const steering = new SteerQueue()
    const fetcher = vi.fn()
      .mockImplementationOnce(async () => {
        steering.push('In Tokyo')
        return json({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_current_time', args: {} } }] }, finishReason: 'STOP' }] })
      })
      .mockResolvedValueOnce(json({ candidates: [{ content: { role: 'model', parts: [{ text: 'Noon in Tokyo.' }] }, finishReason: 'STOP' }] }))
    vi.stubGlobal('fetch', fetcher)
    await geminiAdapter.respond(base({ tools: { browserTools: ['clock'] as BrowserToolName[] }, steering }), false)

    const parts = bodyOf(fetcher, 1).contents.at(-1).parts
    expect(Object.keys(parts[0])).toEqual(['functionResponse'])
    expect(parts[1]).toEqual({ text: 'In Tokyo' })
  })
})

describe('steering mid-request', () => {
  it('Responses: interrupts the stream, keeps the text so far, and continues', async () => {
    const steering = new SteerQueue()
    const final = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Dogs, then.' }] }]
    const fetcher = vi.fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => openStream(init,
        { type: 'response.output_text.delta', delta: 'Cats are' }))
      .mockResolvedValueOnce(sse(
        { type: 'response.output_text.delta', delta: 'Dogs, then.' },
        { type: 'response.completed', response: { output: final } },
      ))
    vi.stubGlobal('fetch', fetcher)
    const shown: string[] = []
    const reply = await responsesAdapter.respond(base({
      steering,
      callbacks: {
        onTextDelta: (full) => {
          shown.push(full)
          if (full === 'Cats are') steering.push('Talk about dogs instead')
        },
      },
    }), true)

    expect(bodyOf(fetcher, 1).input.slice(1)).toEqual([
      { type: 'message', role: 'assistant', content: 'Cats are' },
      { type: 'message', role: 'user', content: 'Talk about dogs instead' },
    ])
    expect(reply.text).toBe('Cats are\n\nDogs, then.')
    expect(shown.at(-1)).toBe('Cats are\n\nDogs, then.')
    expect(steerSteps(reply.activity)).toEqual([expect.objectContaining({ status: 'done', at: 'Cats are'.length })])
    expect((reply.native?.data as Array<{ type: string }>).map(item => item.type)).toEqual(['message', 'message', 'message'])
  })

  it('Anthropic: drops half-written thinking and sends no empty assistant turn', async () => {
    const steering = new SteerQueue()
    const fetcher = vi.fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => openStream(init,
        { type: 'message_start', message: { content: [] } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'The user wants cats' } }))
      .mockResolvedValueOnce(sse(
        { type: 'message_start', message: { content: [] } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Dogs!' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' },
      ))
    vi.stubGlobal('fetch', fetcher)
    const reply = await anthropicAdapter.respond(base({
      model: 'claude-opus-5-5',
      steering,
      callbacks: {
        onActivity: (steps) => {
          if (steps.some(step => step.kind === 'thinking' && step.text) && !steering.pending().length && !steerSteps(steps).length) {
            steering.push('Dogs instead')
          }
        },
      },
    }), true)

    const messages = bodyOf(fetcher, 1).messages
    expect(messages).toEqual([
      { role: 'user', content: 'Tell me about cats' },
      { role: 'user', content: [{ type: 'text', text: 'Dogs instead' }] },
    ])
    expect(reply.text).toBe('Dogs!')
    // The interrupted thinking still shows, finished.
    expect(reply.activity?.find(step => step.kind === 'thinking')).toEqual(expect.objectContaining({ status: 'done', text: 'The user wants cats' }))
  })

  it('a stop is still a stop', async () => {
    const steering = new SteerQueue()
    let abort: (() => void) | null = null
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      queueMicrotask(() => abort?.())
      return openStream(init, { type: 'response.output_text.delta', delta: 'Cats' })
    }))
    await expect(responsesAdapter.respond(base({ steering, provideAbort: fn => { abort = fn } }), true))
      .rejects.toThrow(/abort/i)
  })
})

describe('steering as the reply finishes', () => {
  it('Chat Completions: continues the reply, and replays each turn with its own text', async () => {
    const steering = new SteerQueue()
    const fetcher = vi.fn()
      .mockImplementationOnce(async () => { steering.push('More, please'); return json({ choices: [{ message: { content: 'Cats purr.' } }] }) })
      .mockResolvedValueOnce(json({ choices: [{ message: { content: 'They also knead.' } }] }))
    vi.stubGlobal('fetch', fetcher)
    const reply = await chatCompletionsAdapter.respond(base({ steering }), false)

    expect(bodyOf(fetcher, 1).messages.slice(1)).toEqual([
      { role: 'assistant', content: 'Cats purr.' },
      { role: 'user', content: 'More, please' },
    ])
    expect(reply.text).toBe('Cats purr.\n\nThey also knead.')

    const history = [
      { role: 'user', content: 'Tell me about cats' },
      { role: 'assistant', content: reply.text, native: reply.native },
    ]
    expect(buildChatRequest(base({ input: history })).messages).toEqual([
      { role: 'user', content: 'Tell me about cats' },
      { role: 'assistant', content: 'Cats purr.' },
      { role: 'user', content: 'More, please' },
      { role: 'assistant', content: 'They also knead.' },
    ])
  })
})

describe('steered replies sent back as plain text', () => {
  const history: HistoryMessage[] = [
    { role: 'user', content: 'Tell me about cats' },
    { role: 'assistant', content: 'Cats are\n\nDogs, then.', steers: [{ at: 8, text: 'Talk about dogs instead' }] },
    { role: 'user', content: 'Thanks' },
  ]
  const expected = [
    { role: 'user', content: 'Tell me about cats' },
    { role: 'assistant', content: 'Cats are' },
    { role: 'user', content: 'Talk about dogs instead' },
    { role: 'assistant', content: 'Dogs, then.' },
    { role: 'user', content: 'Thanks' },
  ]

  it('splits the reply where each message reached the model', () => {
    expect(plainTurns({ role: 'assistant', content: 'abc', steers: [{ at: 99, text: 'x' }] }))
      .toEqual([{ role: 'assistant', content: 'abc' }, { role: 'user', content: 'x' }])
    const input = buildProviderInput(history, undefined)
    expect(buildResponsesRequest(base({ input })).input).toEqual(expected)
    expect(buildChatRequest(base({ input })).messages).toEqual(expected)
    expect((buildAnthropicRequest(base({ model: 'claude-opus-5-5', input })).body.messages as unknown[])).toEqual(expected)
    expect(buildGeminiRequest(base({ input })).contents.map(c => c.role)).toEqual(['user', 'model', 'user', 'model', 'user'])
  })

  it('reads the notes from the stored steps, leaving out messages that never arrived', () => {
    const steps: ActivityStep[] = [
      { id: 'a', kind: 'steer', status: 'done', text: 'one', at: 3 },
      { id: 'b', kind: 'steer', status: 'running', text: 'queued' },
      { id: 'c', kind: 'thinking', status: 'done', text: 'hm' },
    ]
    expect(steerNotes(steps)).toEqual([{ at: 3, text: 'one' }])
    expect(settleActivity(steps)?.map(step => step.id)).toEqual(['a', 'c'])
    expect(activityTitle(steps[0]!, false)).toBe('You steered: “one”')
    expect(activityTitle(steps[1]!, true)).toBe('Steering: “queued”')
  })
})

describe('SteerQueue', () => {
  it('ignores blank messages and hands out the rest once', () => {
    const queue = new SteerQueue()
    const seen: string[] = []
    const off = queue.subscribe(steer => seen.push(steer.text))
    expect(queue.push('   ')).toBeNull()
    queue.push(' one ')
    off()
    queue.push('two')
    expect(seen).toEqual(['one'])
    expect(queue.take().map(steer => steer.text)).toEqual(['one', 'two'])
    expect(queue.take()).toEqual([])
  })
})
