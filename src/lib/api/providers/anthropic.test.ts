import { afterEach, describe, expect, it, vi } from 'vitest'
import { anthropicAdapter, buildAnthropicRequest, DEFAULT_ANTHROPIC_BASE_URL, isLegacyClaudeModel, thinkingOffMode } from './anthropic'
import type { ProviderRequestContext } from '../core'
import type { ActivityStep } from '../../types/index.js'

const ctx = (overrides: Partial<ProviderRequestContext> = {}): ProviderRequestContext => ({
  model: 'claude-opus-5-5',
  apiKey: 'sk-ant-test',
  baseURL: 'https://openrouter.ai/api/v1',
  input: [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'hi' },
  ],
  params: {},
  tools: {},
  callbacks: {},
  provideAbort: () => {},
  ...overrides,
})

const sse = (...events: object[]) => new Response(events.map(event => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join(''))

afterEach(() => vi.unstubAllGlobals())

describe('Anthropic request building', () => {
  it('moves system messages to the system field and asks for summarized adaptive thinking', () => {
    const { body, betas } = buildAnthropicRequest(ctx({ params: { reasoningEffort: 'high' } }))
    expect(body.system).toBe('be brief')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(body.output_config).toEqual({ effort: 'high' })
    expect(betas).toEqual([])
  })

  it('starts the conversation with a user turn when it opens with the assistant', () => {
    const { body } = buildAnthropicRequest(ctx({ input: [{ role: 'assistant', content: 'Hello!' }, { role: 'user', content: 'hey' }] }))
    expect((body.messages as Array<{ role: string }>).map(m => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it.each([
    ['claude-opus-5-5', { type: 'adaptive' }, { effort: 'low' }],
    ['claude-sonnet-5-5', { type: 'between_tools' }, undefined],
    ['claude-opus-5', { type: 'disabled' }, undefined],
  ])('turns thinking as far off as %s allows for the "none" level', (model, thinking, outputConfig) => {
    const { body } = buildAnthropicRequest(ctx({ model, params: { reasoningEffort: 'none' } }))
    expect(body.thinking).toEqual(thinking)
    expect(body.output_config).toEqual(outputConfig)
  })

  it('uses a fixed thinking budget on older models', () => {
    expect(isLegacyClaudeModel('claude-sonnet-4-5')).toBe(true)
    expect(isLegacyClaudeModel('claude-sonnet-4-20250514')).toBe(true)
    expect(isLegacyClaudeModel('claude-opus-4-6')).toBe(false)
    expect(thinkingOffMode('claude-fable-5-2')).toBe('always_on')
    const { body } = buildAnthropicRequest(ctx({ model: 'claude-sonnet-4-5', params: { thinkingEnabled: true, thinkingBudgetTokens: 2000, maxOutputTokens: 1000 } }))
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2000 })
    expect(body.max_tokens).toBe(6096)
  })

  it('declares web search, code execution and MCP servers with their toolsets', () => {
    const { body, betas } = buildAnthropicRequest(ctx({
      tools: {
        webSearch: { enabled: true, filters: { allowed_domains: ['example.com'] } },
        codeInterpreter: { enabled: true },
        mcpServers: [{ label: 'Docs', url: 'https://mcp.example.com', authorization: 'tok', allowedTools: 'search' }],
      },
    }))
    expect(body.tools).toEqual([
      { type: 'web_search_20250305', name: 'web_search', allowed_domains: ['example.com'] },
      { type: 'code_execution_20260521', name: 'code_execution' },
      { type: 'mcp_toolset', mcp_server_name: 'Docs', default_config: { enabled: false }, configs: { search: { enabled: true } } },
    ])
    expect(body.mcp_servers).toEqual([{ type: 'url', url: 'https://mcp.example.com', name: 'Docs', authorization_token: 'tok' }])
    expect(betas).toEqual(['mcp-client-2025-11-20'])
  })

  it('uses dynamic-filtering web search when code execution is off', () => {
    const { body } = buildAnthropicRequest(ctx({ tools: { webSearch: { enabled: true } } }))
    expect(body.tools).toEqual([{ type: 'web_search_20260209', name: 'web_search' }])
  })
})

describe('Anthropic responses', () => {
  it('streams text and reports thinking and server tool calls as steps', async () => {
    const fetcher = vi.fn(async () => sse(
      { type: 'message_start', message: { id: 'msg_1' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '**Looking it up**\nNeed a search.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"cats"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', url: 'https://cats.example', title: 'Cats' }] } },
      { type: 'content_block_stop', index: 2 },
      { type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'Cats are great.' } },
      { type: 'content_block_stop', index: 3 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ))
    vi.stubGlobal('fetch', fetcher)
    const updates: ActivityStep[][] = []
    const reply = await anthropicAdapter.respond(ctx({ callbacks: { onActivity: steps => updates.push(steps) } }), true)

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_ANTHROPIC_BASE_URL}/messages`)
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test')
    expect((init.headers as Record<string, string>)['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(reply.text).toBe('Cats are great.')
    expect(reply.activity).toEqual([
      { id: 'thinking-1-0', kind: 'thinking', status: 'done', text: '**Looking it up**\nNeed a search.' },
      { id: 'srv_1', kind: 'search', status: 'done', subject: 'cats', output: 'Cats\nhttps://cats.example' },
    ])
    expect(updates.some(steps => steps.some(step => step.kind === 'search' && step.status === 'running'))).toBe(true)
  })

  it('resumes a paused turn by sending the reply so far back', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [
          { type: 'mcp_tool_use', id: 'mcp_1', name: 'search', server_name: 'Docs', input: { q: 'x' } },
          { type: 'mcp_tool_result', tool_use_id: 'mcp_1', is_error: false, content: [{ type: 'text', text: '{"hits":2}' }] },
        ],
        stop_reason: 'pause_turn',
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Found 2.' }], stop_reason: 'end_turn' })))
    vi.stubGlobal('fetch', fetcher)
    const reply = await anthropicAdapter.respond(ctx(), false)

    const second = JSON.parse((fetcher.mock.calls[1]![1] as RequestInit).body as string)
    expect(second.messages.at(-1)).toEqual({ role: 'assistant', content: [
      { type: 'mcp_tool_use', id: 'mcp_1', name: 'search', server_name: 'Docs', input: { q: 'x' } },
      { type: 'mcp_tool_result', tool_use_id: 'mcp_1', is_error: false, content: [{ type: 'text', text: '{"hits":2}' }] },
    ] })
    expect(reply.text).toBe('Found 2.')
    expect(reply.activity).toEqual([
      { id: 'mcp_1', kind: 'mcp', status: 'done', subject: 'search', server: 'Docs', input: '{\n  "q": "x"\n}', output: '{\n  "hits": 2\n}' },
    ])
  })

  it('explains a refusal that produced no text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', explanation: 'nope' } }))))
    await expect(anthropicAdapter.respond(ctx(), false)).rejects.toThrow('Claude declined to reply: nope')
  })

  it('lists models newest first from the Anthropic endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: 'claude-old', created_at: '2025-01-01T00:00:00Z' },
      { id: 'claude-new', created_at: '2026-06-01T00:00:00Z' },
    ] })))
    vi.stubGlobal('fetch', fetcher)
    expect(await anthropicAdapter.listModels({ apiKey: 'k', baseURL: '' })).toEqual(['claude-new', 'claude-old'])
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(`${DEFAULT_ANTHROPIC_BASE_URL}/models?limit=1000`)
  })
})
