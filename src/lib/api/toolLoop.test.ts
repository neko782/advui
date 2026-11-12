import { afterEach, describe, expect, it, vi } from 'vitest'
import { anthropicAdapter, buildAnthropicRequest } from './providers/anthropic'
import { responsesAdapter, buildResponsesRequest } from './providers/responses'
import { chatCompletionsAdapter, buildChatRequest } from './providers/chatCompletions'
import { geminiAdapter, buildGeminiRequest } from './providers/gemini'
import { parseToolArguments, MAX_TOOL_ROUNDS } from './toolLoop'
import type { ProviderRequestContext } from './core'
import type { BrowserToolName, NativeTurn } from '../types/index.js'

const base = (overrides: Partial<ProviderRequestContext> = {}): ProviderRequestContext => ({
  model: 'test-model',
  apiKey: 'key',
  baseURL: 'https://example.test/v1',
  input: [{ role: 'user', content: 'What time is it?' }],
  params: {},
  tools: { browserTools: ['clock'] as BrowserToolName[] },
  callbacks: {},
  provideAbort: () => {},
  ...overrides,
})

const json = (body: unknown) => new Response(JSON.stringify(body))
const sse = (...events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
const bodyOf = (fetcher: ReturnType<typeof vi.fn>, call: number) => JSON.parse((fetcher.mock.calls[call]![1] as RequestInit).body as string)

afterEach(() => vi.unstubAllGlobals())

describe('parseToolArguments', () => {
  it('accepts objects and JSON object strings, and reports anything else', () => {
    expect(parseToolArguments({ a: 1 })).toEqual({ args: { a: 1 } })
    expect(parseToolArguments('{"code":"1+1"}')).toEqual({ args: { code: '1+1' } })
    expect(parseToolArguments('')).toEqual({ args: {} })
    expect(parseToolArguments('[1]').error).toMatch(/not a valid JSON object/)
    expect(parseToolArguments('{oops').error).toMatch(/not a valid JSON object/)
  })
})

describe('Anthropic browser tools', () => {
  const toolUse = {
    content: [
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_current_time', input: {} },
    ],
    stop_reason: 'tool_use',
  }
  const answer = { content: [{ type: 'text', text: 'It is noon.' }], stop_reason: 'end_turn' }

  it('declares the tools, answers the call and stores every turn for replay', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(toolUse)).mockResolvedValueOnce(json(answer))
    vi.stubGlobal('fetch', fetcher)
    const reply = await anthropicAdapter.respond(base({ model: 'claude-opus-5-5' }), false)

    expect(bodyOf(fetcher, 0).tools).toEqual([expect.objectContaining({ name: 'get_current_time', input_schema: expect.any(Object) })])
    const second = bodyOf(fetcher, 1).messages
    expect(second.slice(1)).toEqual([
      { role: 'assistant', content: toolUse.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: expect.stringContaining('utcOffset') }] },
    ])
    expect(reply.text).toBe('Let me check.\n\nIt is noon.')
    expect(reply.activity).toEqual([expect.objectContaining({ kind: 'time', status: 'done' })])
    expect((reply.native?.data as { messages: unknown[] }).messages).toHaveLength(3)

    // Sent back on the next turn as all three messages while the tool is offered...
    const history = [
      { role: 'user', content: 'What time is it?' },
      { role: 'assistant', content: reply.text, native: reply.native },
      { role: 'user', content: 'Thanks' },
    ]
    const withTools = buildAnthropicRequest(base({ model: 'claude-opus-5-5', input: history })).body.messages as Array<{ role: string }>
    expect(withTools.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    // ...and as plain text once it is not.
    const without = buildAnthropicRequest(base({ model: 'claude-opus-5-5', input: history, tools: {} })).body.messages as Array<{ role: string; content: unknown }>
    expect(without.map(m => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(without[1]!.content).toBe('Let me check.\n\nIt is noon.')
  })

  it('declares web fetch, picking the version that fits the other tools', () => {
    const types = (tools: ProviderRequestContext['tools'], model = 'claude-opus-5-5') =>
      (buildAnthropicRequest(base({ model, tools })).body.tools as Array<{ type?: string }>).map(t => t.type)
    expect(types({ webFetch: true })).toEqual(['web_fetch_20260209'])
    expect(types({ webFetch: true, codeInterpreter: { enabled: true } })).toEqual(['web_fetch_20250910', 'code_execution_20260521'])
    expect(buildAnthropicRequest(base({ model: 'claude-sonnet-4-5', tools: { webFetch: true } })).betas).toContain('web-fetch-2025-09-10')
  })

  it('gives up when the model never stops calling tools', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ content: [{ type: 'tool_use', id: 't', name: 'get_current_time', input: {} }], stop_reason: 'tool_use' })))
    await expect(anthropicAdapter.respond(base({ model: 'claude-opus-5-5' }), false)).rejects.toThrow('kept calling browser tools')
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(MAX_TOOL_ROUNDS)
  })

  it('reports an unknown tool back to the model as an error', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ content: [{ type: 'tool_use', id: 't', name: 'run_javascript', input: { code: '1' } }], stop_reason: 'tool_use' }))
      .mockResolvedValueOnce(json(answer))
    vi.stubGlobal('fetch', fetcher)
    const reply = await anthropicAdapter.respond(base({ model: 'claude-opus-5-5' }), false)
    expect(bodyOf(fetcher, 1).messages.at(-1).content[0]).toMatchObject({ is_error: true, content: 'There is no tool named "run_javascript".' })
    expect(reply.activity?.[0]).toMatchObject({ kind: 'code', status: 'failed' })
  })
})

describe('Responses browser tools', () => {
  it('answers function calls with function_call_output items', async () => {
    const call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'get_current_time', arguments: '{}' }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ output: [call] }))
      .mockResolvedValueOnce(json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Noon.' }] }] }))
    vi.stubGlobal('fetch', fetcher)
    const reply = await responsesAdapter.respond(base(), false)

    expect(bodyOf(fetcher, 0).tools).toEqual([expect.objectContaining({ type: 'function', name: 'get_current_time' })])
    expect(bodyOf(fetcher, 1).input.slice(1)).toEqual([
      call,
      { type: 'function_call_output', call_id: 'call_1', output: expect.stringContaining('utcOffset') },
    ])
    expect(reply.text).toBe('Noon.')
    expect((reply.native?.data as unknown[]).map(item => (item as { type: string }).type)).toEqual(['function_call', 'function_call_output', 'message'])

    // Replayed whole while offered, as the message alone once not.
    const history = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'Noon.', native: reply.native }]
    expect((buildResponsesRequest(base({ input: history })).input as unknown[])).toHaveLength(4)
    expect((buildResponsesRequest(base({ input: history, tools: {} })).input as unknown[])).toEqual([
      { role: 'user', content: 'q' },
      { type: 'message', content: [{ type: 'output_text', text: 'Noon.' }] },
    ])
  })
})

describe('Chat Completions browser tools', () => {
  it('assembles streamed tool calls and answers them with tool messages', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(sse(
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_current', arguments: '' } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: '_time', arguments: '{}' } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ))
      .mockResolvedValueOnce(sse({ choices: [{ index: 0, delta: { content: 'Noon.' } }] }))
    vi.stubGlobal('fetch', fetcher)
    const deltas: string[] = []
    const reply = await chatCompletionsAdapter.respond(base({ callbacks: { onTextDelta: full => deltas.push(full) } }), true)

    expect(bodyOf(fetcher, 0).tools).toEqual([{ type: 'function', function: expect.objectContaining({ name: 'get_current_time' }) }])
    expect(bodyOf(fetcher, 1).messages.slice(1)).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_current_time', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: expect.stringContaining('utcOffset') },
    ])
    expect(reply.text).toBe('Noon.')
    expect(deltas).toEqual(['Noon.'])
    expect((reply.native?.data as { toolTurns: unknown[] }).toolTurns).toHaveLength(2)
  })

  it('asks OpenRouter for web search and shows its citations as a search step', async () => {
    const fetcher = vi.fn(async () => json({ choices: [{ message: {
      content: 'Cats purr.',
      annotations: [{ type: 'url_citation', url_citation: { url: 'https://cats.example', title: 'Cats', start_index: 0, end_index: 4 } }],
    } }] }))
    vi.stubGlobal('fetch', fetcher)
    const reply = await chatCompletionsAdapter.respond(base({ openRouter: true, tools: { webSearch: { enabled: true } } }), false)
    expect(bodyOf(fetcher, 0).plugins).toEqual([{ id: 'web' }])
    expect(reply.webSearchResult?.sources).toEqual([{ url: 'https://cats.example', title: 'Cats' }])
    expect(reply.activity).toEqual([expect.objectContaining({ kind: 'search', output: 'Cats\nhttps://cats.example' })])
    // Without OpenRouter there is no web search to ask for.
    expect(buildChatRequest(base({ tools: { webSearch: { enabled: true } } })).plugins).toBeUndefined()
  })
})

describe('Gemini tools', () => {
  it('declares built-in tools and browser tools together', () => {
    const request = buildGeminiRequest(base({
      tools: { webSearch: { enabled: true }, webFetch: true, codeInterpreter: { enabled: true }, browserTools: ['clock', 'javascript'] },
    }))
    expect(request.tools).toEqual([
      { functionDeclarations: [
        { name: 'get_current_time', description: expect.any(String) },
        { name: 'run_javascript', description: expect.any(String), parametersJsonSchema: expect.objectContaining({ required: ['code'] }) },
      ] },
      { googleSearch: {} },
      { urlContext: {} },
      { codeExecution: {} },
    ])
  })

  it('answers function calls with function responses and stores every turn', async () => {
    const callParts = [{ functionCall: { name: 'get_current_time', args: {} }, thoughtSignature: 'sig' }]
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ candidates: [{ content: { role: 'model', parts: callParts }, finishReason: 'STOP' }] }))
      .mockResolvedValueOnce(json({ candidates: [{ content: { role: 'model', parts: [{ text: 'Noon.' }] }, finishReason: 'STOP' }] }))
    vi.stubGlobal('fetch', fetcher)
    const reply = await geminiAdapter.respond(base(), false)

    expect(bodyOf(fetcher, 1).contents.slice(1)).toEqual([
      { role: 'model', parts: callParts },
      { role: 'user', parts: [{ functionResponse: { name: 'get_current_time', response: { result: expect.stringContaining('utcOffset') } } }] },
    ])
    expect(reply.text).toBe('Noon.')
    const native = reply.native as NativeTurn
    expect((native.data as { contents: unknown[] }).contents).toHaveLength(3)
    const history = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'Noon.', native }]
    expect(buildGeminiRequest(base({ input: history })).contents).toHaveLength(4)
    expect(buildGeminiRequest(base({ input: history, tools: {} })).contents).toEqual([
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ text: 'Noon.' }] },
    ])
  })

  it('reports Google Search, URL context and code execution as steps', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ candidates: [{
      content: { role: 'model', parts: [
        { executableCode: { language: 'PYTHON', code: 'print(2)' } },
        { codeExecutionResult: { outcome: 'OUTCOME_OK', output: '2\n' } },
        { text: 'Two.' },
      ] },
      groundingMetadata: { webSearchQueries: ['cats'], groundingChunks: [{ web: { uri: 'https://cats.example', title: 'Cats' } }] },
      urlContextMetadata: { urlMetadata: [{ retrievedUrl: 'https://a.example', urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_ERROR' }] },
      finishReason: 'STOP',
    }] })))
    const reply = await geminiAdapter.respond(base({ tools: {} }), false)
    expect(reply.activity).toEqual([
      expect.objectContaining({ kind: 'search', subject: 'cats', output: 'Cats\nhttps://cats.example' }),
      expect.objectContaining({ kind: 'fetch', status: 'failed', subject: 'https://a.example', error: 'error' }),
      expect.objectContaining({ kind: 'code', status: 'done', input: 'print(2)', output: '2\n' }),
    ])
    expect(reply.webSearchResult?.sources).toEqual([{ url: 'https://cats.example', title: 'Cats' }])
  })
})
