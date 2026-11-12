import { describe, expect, it } from 'vitest'
import { browserToolSpecs, currentTime, formatSandboxReply, runBrowserTool, searchChatMessages } from './browserTools'
import { activeBrowserTools, normalizeBrowserTools } from '../utils/browserTools'
import { toolsOffFor, unsupportedTools } from '../utils/apiModes'

describe('browser tool selection', () => {
  it('offers the default set until a chat picks its own', () => {
    expect(activeBrowserTools(false, ['clock'])).toEqual([])
    expect(activeBrowserTools(true, undefined)).toEqual(['clock', 'javascript'])
    expect(activeBrowserTools(true, ['chatSearch', 'nope', 'clock'])).toEqual(['clock', 'chatSearch'])
    expect(normalizeBrowserTools('clock')).toBeUndefined()
    expect(browserToolSpecs(['chatSearch']).map(spec => spec.name)).toEqual(['search_chats'])
  })
})

describe('tools per API', () => {
  it('turns off only what the new API cannot use', () => {
    expect(toolsOffFor('responses')).toEqual({ webFetchEnabled: false })
    expect(toolsOffFor('gemini')).toEqual({ shellEnabled: false, imageGenerationEnabled: false, mcpEnabled: false })
    expect(toolsOffFor('chat_completions', true)).not.toHaveProperty('webSearchEnabled')
    expect(toolsOffFor('chat_completions', false)).toMatchObject({ webSearchEnabled: false, codeInterpreterEnabled: false })
    for (const mode of ['responses', 'chat_completions', 'gemini', 'anthropic'] as const) {
      expect(unsupportedTools(mode).browser).toBeFalsy()
    }
  })
})

describe('clock', () => {
  it('gives local time, offset and UTC', () => {
    const result = JSON.parse(currentTime(new Date('2026-03-04T05:06:07Z')))
    expect(result.utc).toBe('2026-03-04T05:06:07.000Z')
    expect(result.utcOffset).toMatch(/^[+-]\d\d:\d\d$/)
    expect(result.local).toMatch(/^2026-03-0\dT\d\d:\d\d:07[+-]\d\d:\d\d$/)
  })
})

describe('chat search', () => {
  const chats = [
    { id: 'a', title: 'Old', updatedAt: Date.UTC(2025, 0, 1), messages: [{ role: 'user', content: 'my cat is called Miso and she likes boxes' }] },
    { id: 'b', title: 'New', updatedAt: Date.UTC(2026, 0, 1), messages: [
      { role: 'assistant', content: 'Boxes are where a cat feels safe.' },
      { role: 'user', content: 'nothing here' },
    ] },
  ]

  it('ranks phrase matches first, then newer chats, and needs every word', () => {
    const { results, total } = JSON.parse(searchChatMessages(chats, 'cat boxes'))
    expect(total).toBe(2)
    expect(results.map((r: { chat: string }) => r.chat)).toEqual(['New', 'Old'])
    const phrase = JSON.parse(searchChatMessages(chats, 'likes boxes'))
    expect(phrase.results).toEqual([expect.objectContaining({ chat: 'Old', role: 'user', date: '2025-01-01' })])
    expect(JSON.parse(searchChatMessages(chats, 'dog')).results).toEqual([])
  })

  it('cuts long messages to an excerpt around the match', () => {
    const long = [{ id: 'c', title: 'Long', messages: [{ role: 'user', content: `${'a '.repeat(400)}needle${' b'.repeat(400)}` }] }]
    const [hit] = JSON.parse(searchChatMessages(long, 'needle')).results
    expect(hit.excerpt).toMatch(/^….*needle.*…$/)
    expect(hit.excerpt.length).toBeLessThan(400)
  })
})

describe('JavaScript sandbox replies', () => {
  it('shows logs, the result and errors', () => {
    expect(formatSandboxReply({ ok: true, logs: [], value: '4' })).toEqual({ output: '4', isError: false })
    expect(formatSandboxReply({ ok: true, logs: ['hi'], value: '4' })).toEqual({ output: 'hi\n\nResult: 4', isError: false })
    expect(formatSandboxReply({ ok: true, logs: [] })).toEqual({ output: '(no output)', isError: false })
    expect(formatSandboxReply({ ok: false, logs: ['a'], error: 'ReferenceError: x' })).toEqual({ output: 'a\n\nError: ReferenceError: x', isError: true })
  })
})

describe('running a call', () => {
  it('only runs tools the chat offers', async () => {
    expect(await runBrowserTool('get_current_time', {}, new Set(['search_chats']))).toMatchObject({ isError: true })
    expect(await runBrowserTool('get_current_time', {}, new Set(['get_current_time']))).toMatchObject({ isError: false })
    expect(await runBrowserTool('run_javascript', { code: ' ' }, new Set(['run_javascript']))).toEqual({ output: 'No code was given.', isError: true })
  })
})
