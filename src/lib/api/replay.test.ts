import { afterEach, describe, expect, it, vi } from 'vitest'
import { anthropicAdapter, buildAnthropicRequest, DEFAULT_ANTHROPIC_BASE_URL } from './providers/anthropic'
import { responsesAdapter, buildResponsesInput } from './providers/responses'
import { geminiAdapter, appendGeminiParts, DEFAULT_GEMINI_BASE_URL } from './providers/gemini'
import { chatCompletionsAdapter, mergeReasoningDetails } from './providers/chatCompletions'
import { accountTag, buildProviderInput, withoutNative, type ProviderRequestContext } from './core'
import type { NativeTurn } from '../types/index.js'

const BASE = 'https://example.test/v1'

const ctx = (overrides: Partial<ProviderRequestContext> = {}): ProviderRequestContext => ({
  model: 'test-model',
  apiKey: 'key',
  baseURL: BASE,
  input: 'hello',
  params: {},
  tools: {},
  callbacks: {},
  provideAbort: () => {},
  ...overrides,
})

const turn = (native: NativeTurn, next = 'and now?') => [
  { role: 'user', content: 'question' },
  { role: 'assistant', content: native.text, native },
  { role: 'user', content: next },
]

const sse = (...events: object[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))

/** The JSON body of the n-th request made through the stubbed fetch. */
const sentBody = (fetcher: ReturnType<typeof vi.fn>, call = 0) => JSON.parse(fetcher.mock.calls[call]![1].body)

afterEach(() => vi.unstubAllGlobals())

describe('history input', () => {
  const native: NativeTurn = { api: 'anthropic', endpoint: BASE, model: 'm', text: 'answer', data: [] }

  it('keeps a stored reply with its assistant message', () => {
    const input = buildProviderInput([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'answer', native }], undefined)
    expect((input as Array<{ native?: NativeTurn }>)[1]?.native).toBe(native)
  })

  it('sends an edited reply as its edited text', () => {
    const input = buildProviderInput([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'edited answer', native }], undefined)
    expect((input as Array<{ native?: NativeTurn }>)[1]).toEqual({ role: 'assistant', content: 'edited answer' })
  })

  it('can drop every stored reply', () => {
    expect(withoutNative(turn(native))).toEqual(turn(native).map(({ native: _n, ...m }) => m))
  })
})

describe('Anthropic replay', () => {
  const blocks = [
    { type: 'thinking', thinking: '', signature: 'sig-1' },
    { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'x' } },
    { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', url: 'https://a', title: 'A', encrypted_content: 'enc' }] },
    { type: 'text', text: 'answer' },
  ]
  const native: NativeTurn = { api: 'anthropic', endpoint: DEFAULT_ANTHROPIC_BASE_URL, model: 'claude-opus-5-5', text: 'answer', data: blocks }
  const request = (overrides: Partial<ProviderRequestContext> = {}) =>
    buildAnthropicRequest(ctx({ model: 'claude-opus-5-5', input: turn(native), tools: { webSearch: { enabled: true } }, ...overrides }))

  it('sends the reply back block for block and asks for invalidated thinking to be dropped', () => {
    const { body, betas } = request()
    expect((body.messages as Array<{ content: unknown }>)[1]).toEqual({ role: 'assistant', content: blocks })
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized', block_binding: { prefix_mismatch_behavior: 'drop_block' } })
    expect(betas).toContain('thinking-binding-controls-2026-08-01')
  })

  it('sends plain text to another endpoint, without the binding controls', () => {
    const { body, betas } = request({ apiBaseUrl: 'https://proxy.example.test/v1' })
    expect((body.messages as Array<{ content: unknown }>)[1]).toEqual({ role: 'assistant', content: 'answer' })
    expect(body.thinking).not.toHaveProperty('block_binding')
    expect(betas).not.toContain('thinking-binding-controls-2026-08-01')
  })

  it('sends plain text once the tool the reply used is no longer declared', () => {
    const { body } = request({ tools: {} })
    expect((body.messages as Array<{ content: unknown }>)[1]).toEqual({ role: 'assistant', content: 'answer' })
  })

  it('sends plain text for thinking that never got its signature', () => {
    const cut = { ...native, data: [{ type: 'thinking', thinking: 'hm', signature: '' }, { type: 'text', text: 'answer' }] }
    const { body } = buildAnthropicRequest(ctx({ model: 'claude-opus-5-5', input: turn(cut) }))
    expect((body.messages as Array<{ content: unknown }>)[1]).toEqual({ role: 'assistant', content: 'answer' })
  })

  it('keeps every block of a reply, signatures and continuations included', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(sse(
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'plan' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"x"}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [] } },
        { type: 'content_block_stop', index: 2 },
        { type: 'message_delta', delta: { stop_reason: 'pause_turn' } },
        { type: 'message_stop' },
      ))
      .mockResolvedValueOnce(sse(
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' },
      ))
    vi.stubGlobal('fetch', fetcher)
    const reply = await anthropicAdapter.respond(ctx({ model: 'claude-opus-5-5', input: 'q', tools: { webSearch: { enabled: true } } }), true)
    expect(reply.native).toEqual({
      api: 'anthropic',
      endpoint: DEFAULT_ANTHROPIC_BASE_URL,
      model: 'claude-opus-5-5',
      text: 'done',
      data: [
        { type: 'thinking', thinking: 'plan', signature: 'sig' },
        { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'x' } },
        { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [] },
        { type: 'text', text: 'done' },
      ],
    })
  })
})

describe('Responses replay', () => {
  const items = [
    { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'enc' },
    { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'x', sources: [{ type: 'url', url: 'https://a.test/' }] } },
    { type: 'message', id: 'msg_1', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'answer', annotations: [] }] },
  ]
  const native: NativeTurn = { api: 'responses', endpoint: BASE, model: 'gpt', account: accountTag('key'), text: 'answer', data: items }
  const messageOnly = { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'answer', annotations: [] }] }
  const ok = () => new Response(JSON.stringify({ output: [] }))
  const refused = (message: string) => new Response(JSON.stringify({ error: { message } }), { status: 400 })

  it('sends the output items back in their original order', () => {
    expect(buildResponsesInput(ctx({ input: turn(native) }))).toEqual([
      { role: 'user', content: 'question' },
      ...items,
      { role: 'user', content: 'and now?' },
    ])
  })

  it('never sends the stored reply field itself', () => {
    const plain = buildResponsesInput(ctx({ baseURL: 'https://other.test/v1', input: turn(native) }))
    expect(plain).toEqual(turn(native).map(({ role, content }) => ({ role, content })))
  })

  it('stores nothing on OpenAI and asks for encrypted reasoning', async () => {
    const fetcher = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetcher)
    await responsesAdapter.respond(ctx(), false)
    expect(sentBody(fetcher)).toMatchObject({ store: false, include: ['reasoning.encrypted_content'] })
  })

  it('asks for web search sources only when web search is on', async () => {
    const fetcher = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetcher)
    await responsesAdapter.respond(ctx({ tools: { webSearch: { enabled: true } } }), false)
    expect(sentBody(fetcher).include).toEqual(['reasoning.encrypted_content', 'web_search_call.action.sources'])
  })

  it('stops asking for web search sources from an endpoint that refuses them', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(refused("Invalid value: 'web_search_call.action.sources'. Supported values are: 'reasoning.encrypted_content'."))
      .mockImplementation(async () => ok())
    vi.stubGlobal('fetch', fetcher)
    const search = ctx({ model: 'no-sources', tools: { webSearch: { enabled: true } } })
    await responsesAdapter.respond(search, false)
    await responsesAdapter.respond(search, false)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(sentBody(fetcher, 1).include).toEqual(['reasoning.encrypted_content'])
    expect(sentBody(fetcher, 2).include).toEqual(['reasoning.encrypted_content'])
  })

  it('follows each search stored without its sources with a results-omitted note', () => {
    const answer = { type: 'message', id: 'msg_1', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'answer', annotations: [] }] }
    const stored = { ...native, data: [
      { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'latest claude model' } },
      { type: 'web_search_call', id: 'ws_2', status: 'completed', action: { type: 'open_page', url: 'https://www.anthropic.com/news/models' } },
      answer,
    ] }
    const note = { role: 'developer', content: '<search results omitted next turn>' }
    const input = buildResponsesInput(ctx({ input: turn(stored) })) as Array<Record<string, unknown>>
    expect(input.slice(1, 5)).toEqual([stored.data[0], note, stored.data[1], answer])
  })

  it('sends only the messages of a reply made under another API key', () => {
    const input = buildResponsesInput(ctx({ apiKey: 'other-org-key', input: turn(native) })) as unknown[]
    expect(input[1]).toEqual(messageOnly)
    expect(input).toHaveLength(3)
  })

  it('sends only the messages of a reply whose reasoning has no encrypted content', () => {
    const stored = { ...native, data: [{ type: 'reasoning', id: 'rs_1', summary: [] }, items[2]] }
    expect((buildResponsesInput(ctx({ input: turn(stored) })) as unknown[])[1]).toEqual(messageOnly)
  })

  it('keeps output items but leaves generated images out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [
      ...items,
      { type: 'image_generation_call', id: 'ig_1', status: 'completed', result: 'aGVsbG8=' },
    ] }))))
    const reply = await responsesAdapter.respond(ctx(), false)
    expect(reply.native?.data).toEqual(items)
    expect(reply.native?.account).toBe(accountTag('key'))
  })

  it('drops earlier reasoning when it cannot be decrypted, keeping the rest', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(refused('The encrypted content for item rs_1 could not be verified.'))
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetcher)
    await responsesAdapter.respond(ctx({ input: turn(native) }), false)
    expect(sentBody(fetcher, 1).input[1]).toEqual(messageOnly)
    expect(sentBody(fetcher, 1).include).toEqual(['reasoning.encrypted_content'])
  })

  it('stops asking for encrypted reasoning from a model that refuses it', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(refused('Encrypted content is not supported with this model.'))
      .mockImplementation(async () => ok())
    vi.stubGlobal('fetch', fetcher)
    await responsesAdapter.respond(ctx({ model: 'no-reasoning' }), false)
    await responsesAdapter.respond(ctx({ model: 'no-reasoning' }), false)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(sentBody(fetcher, 1)).not.toHaveProperty('include')
    expect(sentBody(fetcher, 2)).not.toHaveProperty('include')
    expect(sentBody(fetcher, 2).store).toBe(false)
  })

  it('takes the items from the completed event when streaming', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse(
      { type: 'response.output_text.delta', delta: 'answer' },
      { type: 'response.completed', response: { output: items } },
    )))
    const reply = await responsesAdapter.respond(ctx(), true)
    expect(reply.native).toMatchObject({ api: 'responses', endpoint: BASE, text: 'answer', data: items })
  })
})

describe('Gemini replay', () => {
  it('joins streamed text but never merges a part carrying a signature', () => {
    const parts: Array<Record<string, unknown>> = []
    const chunk = (...p: object[]) => ({ candidates: [{ content: { role: 'model', parts: p } }] })
    appendGeminiParts(parts, chunk({ text: 'thinking ', thought: true }))
    appendGeminiParts(parts, chunk({ text: 'more', thought: true }))
    appendGeminiParts(parts, chunk({ text: 'Hel' }))
    appendGeminiParts(parts, chunk({ text: 'lo' }))
    appendGeminiParts(parts, chunk({ text: '', thoughtSignature: 'sig' }))
    appendGeminiParts(parts, chunk({ text: 'after' }))
    expect(parts).toEqual([
      { text: 'thinking more', thought: true },
      { text: 'Hello' },
      { text: '', thoughtSignature: 'sig' },
      { text: 'after' },
    ])
  })

  it('sends the parts back as the model turn', async () => {
    const parts = [{ text: 'Hello', thoughtSignature: 'sig' }]
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })))
    vi.stubGlobal('fetch', fetcher)
    const native: NativeTurn = { api: 'gemini', endpoint: DEFAULT_GEMINI_BASE_URL, model: 'g', text: 'Hello', data: parts }
    const reply = await geminiAdapter.respond(ctx({ input: turn(native) }), false)
    expect(sentBody(fetcher).contents[1]).toEqual({ role: 'model', parts })
    expect(reply.native?.data).toEqual([{ text: 'ok' }])
  })
})

describe('Chat Completions replay', () => {
  it('joins streamed reasoning_details entries by index', () => {
    const details: Array<Record<string, unknown>> = []
    mergeReasoningDetails(details, [{ type: 'reasoning.text', text: 'a', format: 'anthropic-claude-v1', index: 0 }])
    mergeReasoningDetails(details, [{ type: 'reasoning.text', text: 'b', index: 0 }])
    mergeReasoningDetails(details, [{ type: 'reasoning.text', signature: 'sig', index: 0 }])
    mergeReasoningDetails(details, [{ type: 'reasoning.encrypted', data: 'enc', index: 1 }])
    expect(details).toEqual([
      { type: 'reasoning.text', text: 'ab', format: 'anthropic-claude-v1', signature: 'sig', index: 0 },
      { type: 'reasoning.encrypted', data: 'enc', index: 1 },
    ])
  })

  it('keeps reasoning_details over the plain reasoning text', async () => {
    const delta = (d: object, finish?: string) => ({ choices: [{ index: 0, delta: d, finish_reason: finish ?? null }] })
    vi.stubGlobal('fetch', vi.fn(async () => sse(
      delta({ reasoning: 'r', reasoning_details: [{ type: 'reasoning.text', text: 'r', index: 0 }] }),
      delta({ content: 'answer' }, 'stop'),
    )))
    const reply = await chatCompletionsAdapter.respond(ctx(), true)
    expect(reply.native?.data).toEqual({ reasoning_details: [{ type: 'reasoning.text', text: 'r', index: 0 }] })
  })

  it('keeps reasoning_content when that is what the server sends', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ index: 0, message: { role: 'assistant', content: 'answer', reasoning_content: 'because' } }],
    }))))
    const reply = await chatCompletionsAdapter.respond(ctx(), false)
    expect(reply.native?.data).toEqual({ reasoning_content: 'because' })
  })

  it('sends the reasoning back on the assistant message, and only to the same endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })))
    vi.stubGlobal('fetch', fetcher)
    const native: NativeTurn = { api: 'chat_completions', endpoint: BASE, model: 'm', text: 'answer', data: { reasoning_content: 'because' } }
    await chatCompletionsAdapter.respond(ctx({ input: turn(native) }), false)
    expect(sentBody(fetcher).messages[1]).toEqual({ role: 'assistant', content: 'answer', reasoning_content: 'because' })
    await chatCompletionsAdapter.respond(ctx({ baseURL: 'https://other.test/v1', input: turn(native) }), false)
    expect(sentBody(fetcher, 1).messages[1]).toEqual({ role: 'assistant', content: 'answer' })
  })
})
