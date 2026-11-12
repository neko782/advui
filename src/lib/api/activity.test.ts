import { describe, expect, it } from 'vitest'
import { ActivityLog, activityOf, activityTitle, settleActivity, thinkingTitle } from './activity'
import type { ActivityStep } from '../types/index.js'

describe('activity titles', () => {
  it('summarizes thinking by its latest bold heading', () => {
    expect(thinkingTitle('**Planning**\nfirst\n\n**Checking the docs**\nmore', false)).toBe('Checking the docs')
  })

  it('uses the line being written while thinking without headings', () => {
    expect(thinkingTitle('First idea.\nSecond idea', true)).toBe('Second idea')
    expect(thinkingTitle('First idea.\nSecond idea', false)).toBe('First idea.')
    expect(thinkingTitle('', true)).toBe('Thinking')
  })

  it.each<[Partial<ActivityStep>, string]>([
    [{ kind: 'search', status: 'running', subject: 'svelte runes' }, 'Searching the web for “svelte runes”'],
    [{ kind: 'search', status: 'done' }, 'Searched the web'],
    [{ kind: 'fetch', status: 'done', subject: 'https://example.com' }, 'Read https://example.com'],
    [{ kind: 'code', status: 'done' }, 'Ran code'],
    [{ kind: 'shell', status: 'failed', subject: 'ls -la' }, 'Ran ls -la — failed'],
    [{ kind: 'mcp', status: 'done', subject: 'search_docs', server: 'deepwiki' }, 'Called search_docs on deepwiki'],
    [{ kind: 'mcp_list', status: 'done', subject: '3 tools', server: 'deepwiki' }, 'Loaded 3 tools from deepwiki'],
  ])('titles %o as %s', (step, title) => {
    expect(activityTitle({ id: 'x', ...step } as ActivityStep)).toBe(title)
  })

  it('shows a step left running in a finished reply as done', () => {
    expect(activityTitle({ id: 'x', kind: 'code', status: 'running' }, false)).toBe('Ran code')
  })
})

describe('ActivityLog', () => {
  it('orders steps by output position and reports every change', () => {
    const seen: string[][] = []
    const log = new ActivityLog(steps => seen.push(steps.map(step => step.id)))
    log.set('b', { kind: 'search', status: 'running' }, 2)
    log.append('a', 'text', 'hm', { kind: 'thinking', status: 'running' }, 1)
    expect(seen.at(-1)).toEqual(['a', 'b'])
    expect(log.settle().map(step => step.status)).toEqual(['done', 'done'])
  })

  it('drops thinking that finished without any text', () => {
    const log = new ActivityLog()
    log.set('t', { kind: 'thinking', status: 'running' })
    expect(log.list()).toHaveLength(1)
    expect(log.settle()).toEqual([])
    expect(settleActivity([{ id: 't', kind: 'thinking', status: 'running', text: '' }])).toBeUndefined()
  })
})

describe('chats saved before activity steps', () => {
  it('reads the old reasoning summary and MCP calls as steps', () => {
    expect(activityOf({
      reasoningSummary: 'Old reasoning',
      mcpItems: [
        { type: 'mcp_list_tools', id: 'l', serverLabel: 's', tools: [] },
        { type: 'mcp_call', id: 'c', serverLabel: 's', name: 'tool', arguments: '{"a":1}', output: 'ok', error: null },
      ],
    })).toEqual([
      { id: 'legacy-reasoning', kind: 'thinking', status: 'done', text: 'Old reasoning' },
      { id: 'legacy-mcp-c', kind: 'mcp', status: 'done', subject: 'tool', server: 's', input: '{\n  "a": 1\n}', output: 'ok', error: undefined },
    ])
  })
})
