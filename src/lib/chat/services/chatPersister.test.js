import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../chatsStore.js', () => ({
  saveChatContent: vi.fn(async (id, { nodes, settings, rootId }) => ({
    id,
    title: 't',
    updatedAt: 1,
    nodes,
    settings,
    rootId,
    presetId: null,
  })),
}))

import { createChatPersister, computePersistSig, flushGlobalPersists } from './chatPersistence.js'
import { saveChatContent } from '../../chatsStore.js'

function makeHost(overrides = {}) {
  const state = {
    nodes: [{ id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hi', time: 1, typing: false, next: null }] }],
    chatSettings: { model: 'gpt-5.5', streaming: true },
    rootId: 1,
    debug: false,
  }
  const host = {
    state,
    getChatId: () => 'chat-1',
    getState: () => ({ ...state }),
    canPersist: () => true,
    isDestroyed: () => false,
    isBusy: () => false,
    onSanitized: vi.fn(),
    onChatUpdated: vi.fn(),
    onConflict: vi.fn(),
    onSaveError: vi.fn(),
    ...overrides,
  }
  return host
}

describe('createChatPersister', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await flushGlobalPersists()
    vi.useRealTimers()
  })

  it('persists changed content once and dedupes unchanged requests', async () => {
    const host = makeHost()
    const persister = createChatPersister(host)

    persister.requestPersist()
    persister.requestPersist()
    await vi.runAllTimersAsync()

    expect(saveChatContent).toHaveBeenCalledTimes(1)

    // Content unchanged: no further writes
    persister.requestPersist()
    await vi.runAllTimersAsync()
    expect(saveChatContent).toHaveBeenCalledTimes(1)
  })

  it('does not persist while busy or when host cannot persist', async () => {
    const busyHost = makeHost({ isBusy: () => true })
    const busyPersister = createChatPersister(busyHost)
    busyPersister.requestPersist()
    await vi.runAllTimersAsync()
    expect(saveChatContent).not.toHaveBeenCalled()

    const notReadyHost = makeHost({ canPersist: () => false })
    const notReadyPersister = createChatPersister(notReadyHost)
    notReadyPersister.requestPersist()
    await notReadyPersister.persistNow()
    await vi.runAllTimersAsync()
    expect(saveChatContent).not.toHaveBeenCalled()
  })

  it('skips content already marked as persisted', async () => {
    const host = makeHost()
    const persister = createChatPersister(host)
    const sig = computePersistSig(host.state.nodes, host.state.chatSettings, host.state.rootId)
    persister.markPersisted(sig)

    persister.requestPersist()
    await vi.runAllTimersAsync()
    expect(saveChatContent).not.toHaveBeenCalled()

    persister.reset()
    persister.requestPersist()
    await vi.runAllTimersAsync()
    expect(saveChatContent).toHaveBeenCalledTimes(1)
  })

  it('reports conflicts and does not schedule the error-retry timer', async () => {
    const host = makeHost()
    saveChatContent.mockRejectedValueOnce(new Error('Concurrent modification conflict for chat "chat-1".'))
    const persister = createChatPersister(host)

    persister.requestPersist()
    await vi.runAllTimersAsync()

    expect(host.onConflict).toHaveBeenCalledTimes(1)
    expect(host.onSaveError).not.toHaveBeenCalled()
    // A follow-up attempt is re-queued (storage refetches versions), succeeds,
    // and no further writes happen once the signature matches.
    expect(saveChatContent).toHaveBeenCalledTimes(2)
  })

  it('retries after a non-conflict save error', async () => {
    const host = makeHost()
    saveChatContent.mockRejectedValueOnce(new Error('boom'))
    const persister = createChatPersister(host)

    persister.requestPersist()
    await vi.runAllTimersAsync()

    expect(host.onSaveError).toHaveBeenCalledWith('boom')
    // Retry timer fired and second attempt succeeded
    expect(saveChatContent).toHaveBeenCalledTimes(2)
    expect(host.onChatUpdated).toHaveBeenCalled()
  })

  it('notifies parent via debounced refresh after successful persist', async () => {
    const host = makeHost()
    const persister = createChatPersister(host)

    await persister.persistNow()
    await vi.runAllTimersAsync()

    expect(host.onChatUpdated).toHaveBeenCalledTimes(1)
    expect(host.onChatUpdated.mock.calls[0][0]).toMatchObject({ id: 'chat-1' })
  })
})
