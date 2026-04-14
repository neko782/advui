import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { respond } from './openaiClient.js'
import { saveSettings } from './settingsStore.js'

const encoder = new TextEncoder()
const connectionId = 'test-connection'
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value) },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
    get length() { return Object.keys(store).length },
    key: (index: number) => Object.keys(store)[index] ?? null,
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

function configureConnection(apiMode: 'responses' | 'chat_completions') {
  saveSettings({
    connections: [
      {
        id: connectionId,
        name: 'Test',
        apiKey: 'test-key',
        apiBaseUrl: 'https://example.test/v1',
        apiMode,
      },
    ],
    selectedConnectionId: connectionId,
  })
}

function makeSseResponse(chunks: string[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}

describe('respond stream errors', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('throws when a Responses stream emits an error event', async () => {
    configureConnection('responses')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeSseResponse([
      'event: error\n',
      'data: {"type":"error","error":{"type":"insufficient_quota","message":"Quota exceeded"}}\n\n',
    ])))

    await expect(respond({
      model: 'gpt-4o-mini',
      prompt: 'hi',
      connectionId,
      stream: true,
    })).rejects.toThrow('Quota exceeded')
  })

  it('throws when a Responses stream emits response.failed', async () => {
    configureConnection('responses')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeSseResponse([
      'event: response.failed\n',
      'data: {"type":"response.failed","response":{"status":"failed","error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}}\n\n',
    ])))

    await expect(respond({
      model: 'gpt-4o-mini',
      prompt: 'hi',
      connectionId,
      stream: true,
    })).rejects.toThrow('You exceeded your current quota')
  })

  it('throws when a chat completions stream emits a Claude-style error event', async () => {
    configureConnection('chat_completions')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeSseResponse([
      'event: error\n',
      'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
    ])))

    await expect(respond({
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'hi' }],
      connectionId,
      stream: true,
    })).rejects.toThrow('Overloaded')
  })

  it('keeps reasoning summary segments from separate output items around web search', async () => {
    configureConnection('responses')
    const reasoningDeltas: string[] = []
    const reasoningDone: string[] = []
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeSseResponse([
      'event: response.reasoning_summary_text.delta\n',
      'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","output_index":0,"summary_index":0,"delta":"First pass"}\n\n',
      'event: response.reasoning_summary_text.done\n',
      'data: {"type":"response.reasoning_summary_text.done","item_id":"rs_1","output_index":0,"summary_index":0,"text":"First pass"}\n\n',
      'event: response.web_search_call.completed\n',
      'data: {"type":"response.web_search_call.completed","item_id":"ws_1","output_index":1,"action":{"type":"search","sources":[{"type":"url","url":"https://example.com"}]}}\n\n',
      'event: response.reasoning_summary_text.delta\n',
      'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_2","output_index":2,"summary_index":0,"delta":"Second pass"}\n\n',
      'event: response.reasoning_summary_text.done\n',
      'data: {"type":"response.reasoning_summary_text.done","item_id":"rs_2","output_index":2,"summary_index":0,"text":"Second pass"}\n\n',
      'event: response.completed\n',
      'data: {"type":"response.completed","response":{"output":[]}}\n\n',
    ])))

    const response = await respond({
      model: 'gpt-5.4',
      prompt: 'hi',
      connectionId,
      stream: true,
      onReasoningSummaryDelta: (fullSummary) => reasoningDeltas.push(fullSummary),
      onReasoningSummaryDone: (fullSummary) => reasoningDone.push(fullSummary),
    })

    // Reasoning deltas now include tool activity interleaved by output_index
    expect(reasoningDeltas).toEqual([
      'First pass',
      'First pass\n\n**Web search** \u2014 *completed*',
      'First pass\n\n**Web search** \u2014 *completed*\n\nSecond pass',
    ])
    expect(reasoningDone).toEqual([
      'First pass',
      'First pass\n\n**Web search** \u2014 *completed*\n\nSecond pass',
    ])
    // Final response preserves tool activity interleaved with reasoning
    expect(response.reasoningSummary).toBe('First pass\n\n**Web search** \u2014 *completed*\n\nSecond pass')
  })

  it('adds code interpreter to Responses API tools', async () => {
    configureConnection('responses')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await respond({
      model: 'gpt-5.4',
      prompt: 'hi',
      connectionId,
      webSearch: { enabled: true },
      codeInterpreter: { enabled: true },
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.tools).toEqual([
      { type: 'web_search' },
      { type: 'code_interpreter', container: { type: 'auto' } },
    ])
  })

  it('does not add code interpreter to Chat Completions requests', async () => {
    configureConnection('chat_completions')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await respond({
      model: 'gpt-4o-mini',
      prompt: 'hi',
      connectionId,
      codeInterpreter: { enabled: true },
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.tools).toBeUndefined()
  })

  it('adds shell to Responses API tools', async () => {
    configureConnection('responses')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await respond({
      model: 'gpt-5.4',
      prompt: 'hi',
      connectionId,
      shell: { enabled: true },
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.tools).toEqual([
      { type: 'shell', environment: { type: 'container_auto' } },
    ])
  })

  it('does not add shell to Chat Completions requests', async () => {
    configureConnection('chat_completions')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await respond({
      model: 'gpt-4o-mini',
      prompt: 'hi',
      connectionId,
      shell: { enabled: true },
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.tools).toBeUndefined()
  })

  it('adds MCP servers to Responses API tools', async () => {
    configureConnection('responses')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await respond({
      model: 'gpt-5.4',
      prompt: 'hi',
      connectionId,
      mcpServers: [
        { label: 'deepwiki', url: 'https://example.com/mcp' },
      ],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.tools).toEqual([
      {
        type: 'mcp',
        server_label: 'deepwiki',
        server_url: 'https://example.com/mcp',
        require_approval: 'never',
      },
    ])
  })

  it('extracts MCP output items from Responses API responses', async () => {
    configureConnection('responses')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: 'done',
      output: [
        {
          id: 'mcp_list_1',
          type: 'mcp_list_tools',
          server_label: 'deepwiki',
          tools: [
            { name: 'search_docs', description: 'Search docs', input_schema: { type: 'object' } },
          ],
        },
        {
          id: 'mcp_call_1',
          type: 'mcp_call',
          server_label: 'deepwiki',
          name: 'search_docs',
          arguments: '{"query":"mcp"}',
          output: '{"hits":1}',
          status: 'completed',
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    const response = await respond({
      model: 'gpt-5.4',
      prompt: 'hi',
      connectionId,
    })

    expect(response.mcpItems).toEqual([
      {
        id: 'mcp_list_1',
        type: 'mcp_list_tools',
        serverLabel: 'deepwiki',
        tools: [
          {
            name: 'search_docs',
            description: 'Search docs',
            annotations: undefined,
            inputSchema: { type: 'object' },
          },
        ],
        error: null,
      },
      {
        id: 'mcp_call_1',
        type: 'mcp_call',
        serverLabel: 'deepwiki',
        name: 'search_docs',
        arguments: '{"query":"mcp"}',
        output: '{"hits":1}',
        error: null,
        status: 'completed',
        approvalRequestId: null,
      },
    ])
  })
})
