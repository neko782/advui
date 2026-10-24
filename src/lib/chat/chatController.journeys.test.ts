// @vitest-environment happy-dom
// End-to-end chat journeys: a real ChatController over real persistence
// (chatsStore → storage → IndexedDB via fake-indexeddb). Only the provider
// call (openaiClient.respond) is replaced with a controllable fake stream.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../openaiClient.js', () => ({ respond: vi.fn() }))
vi.mock('../storage.indexeddb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage.indexeddb.js')>()
  return { ...actual, putChat: vi.fn(actual.putChat), getChat: vi.fn(actual.getChat) }
})

import { respond } from '../openaiClient.js'
import * as idb from '../storage.indexeddb.js'
import { ConflictError } from '../storage.errors.js'
import { updateChatAtomic } from '../storage.js'
import { ChatController } from './chatController.svelte.js'
import { createChat, getChat, unlockAllChats } from '../chatsStore.js'
import { saveSettings, loadSettings } from '../settingsStore.js'
import type { Chat, ChatNode, GenerationResponse } from '../types/index.js'

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

const respondMock = vi.mocked(respond)
const idbPutChat = vi.mocked(idb.putChat)
const idbGetChat = vi.mocked(idb.getChat)

// ---------------------------------------------------------------------------
// Fake provider stream
// ---------------------------------------------------------------------------

interface FakeReply {
  /** Resolves once the controller has actually issued the request. */
  started: Promise<void>
  delta(text: string): void
  finish(text: string): void
  fail(err: Error): void
  readonly aborted: boolean
}

function queueReply(): FakeReply {
  let markStarted!: () => void
  const started = new Promise<void>(r => { markStarted = r })
  let resolve!: (value: GenerationResponse) => void
  let reject!: (err: Error) => void
  let onTextDelta: ((full: string) => void) | undefined
  let aborted = false

  respondMock.mockImplementationOnce((options) => new Promise<GenerationResponse>((res, rej) => {
    resolve = res
    reject = rej
    onTextDelta = options.onTextDelta as typeof onTextDelta
    options.onAbort?.(() => {
      aborted = true
      rej(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
    })
    markStarted()
  }))

  return {
    started,
    delta: (text) => onTextDelta?.(text),
    finish: (text) => resolve({ text } as GenerationResponse),
    fail: (err) => reject(err),
    get aborted() { return aborted },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeRegistry() {
  const map: Record<string, boolean> = {}
  return {
    map,
    setGenerating(chatId: string, generating: boolean) {
      if (generating) map[chatId] = true
      else delete map[chatId]
    },
  }
}

type Registry = ReturnType<typeof fakeRegistry>

async function openChat(chatId: string, registry: Registry = fakeRegistry()) {
  const chat = new ChatController({ chatId, initialSettings: loadSettings(), registry })
  await chat.load(chatId)
  expect(chat.status).toBe('ready')
  return chat
}

function transcript(chat: ChatController): string[] {
  return chat.visibleMessages.filter(vm => vm.m.role !== 'system').map(vm => `${vm.m.role}: ${vm.m.content}`)
}

function storedTranscript(stored: Chat | null): string[] {
  if (!stored) return []
  const byId = new Map<number, ChatNode>(stored.nodes.map(n => [n.id, n]))
  const out: string[] = []
  let cur: number | null = stored.rootId
  while (cur != null) {
    const node = byId.get(cur)
    if (!node) break
    const v = node.variants[node.active ?? 0]
    if (!v) break
    if (v.role !== 'system') out.push(`${v.role}: ${v.content}${v.typing ? ' [typing]' : ''}`)
    cur = v.next ?? null
  }
  return out
}

async function eventually(assertion: () => void | Promise<void>, timeout = 3000) {
  await vi.waitFor(assertion, { timeout, interval: 10 })
}

async function say(chat: ChatController, text: string, reply: string) {
  const pending = queueReply()
  chat.setInput(text)
  const sent = chat.send()
  await pending.started
  pending.finish(reply)
  await sent
}

let cleanup: ChatController[] = []

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  saveSettings({
    ...loadSettings(),
    connections: [{ id: 'conn-test', name: 'Test', apiKey: 'sk-test', apiBaseUrl: 'https://example.invalid/v1', apiMode: 'responses' }],
    selectedConnectionId: 'conn-test',
  } as never)
})

afterEach(() => {
  for (const chat of cleanup) chat.dispose()
  cleanup = []
})

async function newChat(): Promise<string> {
  const { id } = await createChat()
  return id
}

async function track(chat: Promise<ChatController>): Promise<ChatController> {
  const c = await chat
  cleanup.push(c)
  return c
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

describe('journey: switching chats while an answer streams', () => {
  it('keeps the background answer in its own chat and lets the other chat work', async () => {
    const registry = fakeRegistry()
    const a = await track(openChat(await newChat(), registry))
    const b = await track(openChat(await newChat(), registry))

    // Start streaming in A, then "switch" to B (the app keeps A mounted).
    const replyA = queueReply()
    a.setInput('question for A')
    const sendingA = a.send()
    await replyA.started
    replyA.delta('partial A')
    expect(registry.map[a.chatId]).toBe(true)
    expect(a.sending).toBe(true)
    expect(a.locked).toBe(true)

    // B is fully usable while A streams.
    expect(b.locked).toBe(false)
    await say(b, 'question for B', 'answer B')
    expect(transcript(b)).toEqual(['user: question for B', 'assistant: answer B'])

    // A keeps streaming in the background and finishes into A only.
    replyA.delta('partial A, more')
    replyA.finish('full answer A')
    await sendingA
    expect(registry.map).toEqual({})
    expect(transcript(a)).toEqual(['user: question for A', 'assistant: full answer A'])

    await eventually(async () => {
      expect(storedTranscript(await getChat(a.chatId))).toEqual(['user: question for A', 'assistant: full answer A'])
      expect(storedTranscript(await getChat(b.chatId))).toEqual(['user: question for B', 'assistant: answer B'])
    })
  })

  it('aborts the request and saves the partial answer when the chat is closed mid-stream', async () => {
    const registry = fakeRegistry()
    const chat = await openChat(await newChat(), registry)
    const reply = queueReply()
    chat.setInput('long question')
    const sending = chat.send()
    await reply.started
    reply.delta('half an ans')

    chat.dispose()
    await sending

    expect(reply.aborted).toBe(true)
    expect(registry.map).toEqual({})
    await eventually(async () => {
      expect(storedTranscript(await getChat(chat.chatId))).toEqual(['user: long question', 'assistant: half an ans'])
    })
  })

  it('discards late stream updates after Stop', async () => {
    const chat = await track(openChat(await newChat()))
    const reply = queueReply()
    chat.setInput('q')
    const sending = chat.send()
    await reply.started
    reply.delta('kept')

    chat.stop()
    expect(reply.aborted).toBe(true)
    expect(chat.sending).toBe(false)
    expect(chat.locked).toBe(false)

    // A transport that ignores abort and keeps emitting must not write.
    reply.delta('kept + late garbage')
    await sending
    expect(transcript(chat)).toEqual(['user: q', 'assistant: kept'])
  })
})

describe('journey: editing a branch and regenerating its continuation', () => {
  it('creates a new branch while keeping the original conversation reachable', async () => {
    const chat = await track(openChat(await newChat()))
    await say(chat, 'hi', 'reply 1')
    await say(chat, 'more', 'reply 2')

    const firstUser = chat.visibleMessages.find(vm => vm.m.content === 'hi')!.m.id
    chat.startEdit(firstUser)
    chat.setEditingText('hello')
    const reply = queueReply()
    const sending = chat.commitEditAndSend()
    await reply.started
    reply.finish('reply 3')
    await sending

    expect(transcript(chat)).toEqual(['user: hello', 'assistant: reply 3'])

    // Switching back to the original variant restores its whole continuation.
    const editedUser = chat.visibleMessages.find(vm => vm.m.content === 'hello')!.m.id
    chat.changeVariant(editedUser, -1)
    expect(transcript(chat)).toEqual(['user: hi', 'assistant: reply 1', 'user: more', 'assistant: reply 2'])

    // And the branch choice survives a reload.
    await eventually(async () => {
      expect(storedTranscript(await getChat(chat.chatId))).toEqual(['user: hi', 'assistant: reply 1', 'user: more', 'assistant: reply 2'])
    })
    const reopened = await track(openChat(chat.chatId))
    const original = reopened.visibleMessages.find(vm => vm.m.content === 'hi')!.m.id
    reopened.changeVariant(original, 1)
    expect(transcript(reopened)).toEqual(['user: hello', 'assistant: reply 3'])
  })

  it('regenerates an assistant reply as a new variant', async () => {
    const chat = await track(openChat(await newChat()))
    await say(chat, 'hi', 'first take')

    const assistant = chat.visibleMessages.find(vm => vm.m.content === 'first take')!.m.id
    const reply = queueReply()
    const regenerating = chat.regenerate(assistant)
    await reply.started
    reply.finish('second take')
    await regenerating

    expect(transcript(chat)).toEqual(['user: hi', 'assistant: second take'])
    const current = chat.visibleMessages.find(vm => vm.m.content === 'second take')!.m.id
    chat.changeVariant(current, -1)
    expect(transcript(chat)).toEqual(['user: hi', 'assistant: first take'])
  })
})

describe('journey: reloading after an interrupted generation', () => {
  it('reopens unlocked with the partial reply when the tab died mid-stream', async () => {
    const chat = await openChat(await newChat())
    const reply = queueReply()
    chat.setInput('question')
    void chat.send()
    await reply.started
    reply.delta('partial')
    // The typing placeholder is saved when generation starts.
    await eventually(async () => {
      expect(storedTranscript(await getChat(chat.chatId))).toEqual(['user: question', 'assistant: typing [typing]'])
    })
    // Simulate the tab being killed: no dispose, no further writes.

    await unlockAllChats() // app startup
    const reopened = await track(openChat(chat.chatId))
    expect(reopened.locked).toBe(false)
    expect(reopened.nodes.some(n => n.variants.some(v => v.typing))).toBe(false)
    // The placeholder is not presented as a finished reply.
    const interrupted = reopened.visibleMessages.at(-1)!.m
    expect(interrupted.content).toBe('')
    expect(interrupted.error).toMatch(/interrupted/i)

    // The chat is usable again.
    await say(reopened, 'try again', 'answer')
    expect(transcript(reopened).slice(-2)).toEqual(['user: try again', 'assistant: answer'])
    respondMock.mockReset()
  })
})

describe('journey: conflicting saves from two tabs', () => {
  it('detects a write from another tab between read and write, and retries on fresh data', async () => {
    const id = await newChat()
    let interleaved = false
    idbPutChat.mockImplementationOnce(async (chat) => {
      // Another tab writes after this tab read the chat but before it wrote.
      const actual = await vi.importActual<typeof import('../storage.indexeddb.js')>('../storage.indexeddb.js')
      const latest = await actual.getChat(chat.id)
      await actual.putChat({ ...latest!, title: 'from other tab', _expectedVersion: latest!._version })
      interleaved = true
      return actual.putChat(chat) // now stale → ConflictError
    })

    const seen: Array<string | undefined> = []
    await updateChatAtomic(id, (current) => {
      seen.push(current?.title)
      return { ...current!, title: `${current!.title} + this tab` }
    })

    expect(interleaved).toBe(true)
    // The retry re-read the other tab's write instead of clobbering it.
    expect(seen.at(-1)).toBe('from other tab')
    expect((await getChat(id))?.title).toBe('from other tab + this tab')
  })

  it('tells the user when conflicts persist and recovers on the next save', async () => {
    const chat = await track(openChat(await newChat()))
    idbPutChat.mockRejectedValueOnce(new ConflictError(chat.chatId, 'modification'))
    idbPutChat.mockRejectedValueOnce(new ConflictError(chat.chatId, 'modification'))
    idbPutChat.mockRejectedValueOnce(new ConflictError(chat.chatId, 'modification'))

    chat.setInput('note')
    chat.addToChat('user')
    await eventually(() => expect(chat.visibleNotice).toContain('modified in another tab'))
    // Local state is kept, not rolled back.
    expect(transcript(chat)).toEqual(['user: note'])

    chat.setInput('another note')
    chat.addToChat('user')
    await eventually(async () => {
      expect(storedTranscript(await getChat(chat.chatId))).toEqual(['user: note', 'user: another note'])
    })
    expect(chat.visibleNotice).not.toContain('modified in another tab')
  })
})

describe('journey: storage failures', () => {
  it('reports a failed save, keeps the message and saves it once storage recovers', async () => {
    const chat = await track(openChat(await newChat()))
    const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    idbPutChat.mockRejectedValueOnce(quota)

    chat.setInput('important')
    chat.addToChat('user')
    await eventually(() => expect(chat.visibleNotice).toMatch(/storage is full/i))
    expect(transcript(chat)).toEqual(['user: important'])

    // The persister retries on its own once storage works again.
    await eventually(async () => {
      expect(storedTranscript(await getChat(chat.chatId))).toEqual(['user: important'])
    })
    await eventually(() => expect(chat.visibleNotice).not.toMatch(/storage is full/i))
  })

  it('shows a load error instead of an empty chat, and never overwrites the stored chat', async () => {
    const seeded = await track(openChat(await newChat()))
    await say(seeded, 'keep me', 'safe')
    await eventually(async () => {
      expect(storedTranscript(await getChat(seeded.chatId))).toEqual(['user: keep me', 'assistant: safe'])
    })

    idbGetChat.mockRejectedValueOnce(Object.assign(new Error('db broke'), { name: 'UnknownError' }))
    const chat = new ChatController({ chatId: seeded.chatId, initialSettings: loadSettings(), registry: fakeRegistry() })
    cleanup.push(chat)
    await chat.load(seeded.chatId)
    expect(idbGetChat).toHaveBeenCalled()

    expect(chat.status).toBe('error')
    expect(chat.loadError).toContain('db broke')
    expect(chat.locked).toBe(true)
    chat.setInput('typed during outage')
    await chat.send()
    chat.addToChat('user')
    chat.autoPersist()
    await new Promise(r => setTimeout(r, 120))
    expect(storedTranscript(await getChat(seeded.chatId))).toEqual(['user: keep me', 'assistant: safe'])

    await chat.retryLoad()
    expect(chat.status).toBe('ready')
    expect(transcript(chat)).toEqual(['user: keep me', 'assistant: safe'])
  })
})
