<script>
  // Svelte 5 runes API
  import { loadSettings } from './settingsStore.js'
  import { ensureModels, loadModelsCache } from './modelsStore.js'
  import { respond } from './openaiClient.js'
  import { getChat as loadChatById, saveChatContent } from './chatsStore.js'
  // dom utils used within child components
  import { copyText as copyToClipboard } from './utils/clipboard.js'
  import MessageList from './components/chat/MessageList.svelte'
  import Composer from './components/chat/Composer.svelte'
  const props = $props()

  let messages = $state([])
  let input = $state('')
  let sending = $state(false)
  // Lock all chat actions while a response is generating (sending or any typing)
  let locked = $state(false)
  let nextId = $state(1)
  let settings = $state(loadSettings())
  // Group per-chat settings in a single object (seeded from global defaults)
  let chatSettings = $state({
    model: (settings?.defaultChat?.model) || 'gpt-4o-mini',
    streaming: (typeof settings?.defaultChat?.streaming === 'boolean' ? settings.defaultChat.streaming : true),
  })
  // Per-chat settings popover open state
  let chatSettingsOpen = $state(false)
  // Cached models (for datalist)
  let modelIds = $state(loadModelsCache().ids || [])
  let editingId = $state(null)
  let editingText = $state('')
  // editing DOM is handled in MessageBubble
  // Branching helpers (graph-based)
  import { buildVisible as _buildVisible, buildVisibleUpTo as _buildVisibleUpTo, findParentId } from './branching.js'
  function buildVisible() { return _buildVisible(messages, rootId, selected) }
  function buildVisibleUpTo(indexExclusive) { return _buildVisibleUpTo(messages, rootId, selected, indexExclusive) }
  // Graph selections: root message id and selected child per message
  let rootId = $state(1)
  let selected = $state({})
  function computeFollowingMap() {
    const map = {}
    const visible = buildVisible()
    for (let j = 0; j < visible.length; j++) {
      const next = visible[j + 1]?.m
      if (next && next.role === 'assistant') {
        map[j] = { has: true, id: next.id, typing: !!next.typing }
      } else {
        map[j] = { has: false, id: null, typing: false }
      }
    }
    return map
  }
  function onEditableInput(eOrText) {
    if (editingId == null) return
    try {
      if (typeof eOrText === 'string') {
        editingText = eOrText
      } else {
        editingText = eOrText?.currentTarget?.innerText ?? editingText
      }
    } catch {}
  }
  function onEditableKeydown(e) {
    // Ctrl/Cmd+Enter to save, Escape to cancel; Enter alone inserts newline
    if ((e.key === 'Enter') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      commitEdit()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }
  // paste handling occurs inside MessageBubble while editing

  // Build a system prologue message (pure)
  function makeSystemPrologue(idBase = 1) {
    return {
      id: idBase,
      role: 'system',
      content: 'You are a helpful assistant.',
      time: Date.now()
    }
  }

  function recomputeNextId() {
    try {
      const maxId = (messages || []).reduce((mx, m) => Math.max(mx, Number(m?.id) || 0), 0)
      nextId = maxId + 1
    } catch { nextId = 1 }
  }

  function newChat() { props.onNewChat?.() }

  // Initialize when a chatId is provided/changes
  let ready = false
  // Track last chat id to flush unsaved changes when switching away
  let lastChatId = null
  $effect(() => {
    const cid = props.chatId
    // If we are switching away from a chat, flush its latest state immediately
    if (lastChatId && lastChatId !== cid && mounted) {
      try { saveChatContent(lastChatId, { messages, settings: chatSettings }) } catch {}
    }
    lastChatId = cid
    // Reset runtime state whenever switching chats
    ready = false
    // Reset persistence signature to avoid carrying it across chats
    persistSig = ''
    if (!cid) return
    // Compute the new state first, then apply it in a macrotask to avoid
    // mutating state during the current reconciliation/flush.
    let nextMessages = []
    let nextRootId = 1
    let nextSelected = {}
    let nextSettings = loadSettings()
    let nextChatSettings = {
      model: (nextSettings?.defaultChat?.model) || 'gpt-4o-mini',
      streaming: (typeof nextSettings?.defaultChat?.streaming === 'boolean' ? nextSettings.defaultChat.streaming : true)
    }
    let nextNextId = 1
    let nextPersistSig = ''
    loadChatById(cid).then((loaded) => {
      try {
        if (loaded) {
          nextMessages = Array.isArray(loaded.messages) ? loaded.messages.slice() : []
          nextRootId = loaded?.rootId || (nextMessages[0]?.id || 1)
          nextSelected = loaded?.selected || {}
          nextChatSettings = {
            model: loaded?.settings?.model || (nextSettings?.defaultChat?.model) || 'gpt-4o-mini',
            streaming: (typeof loaded?.settings?.streaming === 'boolean'
              ? loaded.settings.streaming
              : (typeof nextSettings?.defaultChat?.streaming === 'boolean' ? nextSettings.defaultChat.streaming : true))
          }
          if (!nextMessages.length) {
            nextNextId = 2
            nextMessages = [{ ...makeSystemPrologue(1), next: [] }]
          } else {
            try {
              const maxId = (nextMessages || []).reduce((mx, m) => Math.max(mx, Number(m?.id) || 0), 0)
              nextNextId = maxId + 1
            } catch { nextNextId = 1 }
          }
        } else {
          nextMessages = [{ ...makeSystemPrologue(1), next: [] }]
          nextRootId = 1
          nextSelected = {}
          nextNextId = 2
          nextChatSettings = {
            model: (nextSettings?.defaultChat?.model) || 'gpt-4o-mini',
            streaming: (typeof nextSettings?.defaultChat?.streaming === 'boolean' ? nextSettings.defaultChat.streaming : true)
          }
        }
      } catch {
        nextSettings = loadSettings()
        nextMessages = [{ ...makeSystemPrologue(1), next: [] }]
        nextRootId = 1
        nextSelected = {}
        nextNextId = 2
        nextChatSettings = {
          model: (nextSettings?.defaultChat?.model) || 'gpt-4o-mini',
          streaming: (typeof nextSettings?.defaultChat?.streaming === 'boolean' ? nextSettings.defaultChat.streaming : true)
        }
      }
      // Precompute a persist signature for the loaded chat content
      try {
        const mini = (nextMessages || []).map(m => `${m.id}|${m.role}|${m.content?.length||0}|${(Array.isArray(m.next)?m.next.length:0)}`)
        nextPersistSig = JSON.stringify({ m: mini, model: nextChatSettings?.model || '', streaming: !!nextChatSettings?.streaming, rootId: nextRootId, s: nextSelected })
      } catch { nextPersistSig = '' }
      // Apply computed state after the current tick
      setTimeout(() => {
        try {
          settings = nextSettings
          messages = nextMessages
          nextId = nextNextId
          chatSettings = nextChatSettings
          rootId = nextRootId
          selected = nextSelected
          editingId = null
          editingText = ''
          // Align persistence signature to loaded state
          persistSig = nextPersistSig
        } finally {
          ready = true
        }
      }, 0)
    }).catch(() => {
      nextSettings = loadSettings()
      nextMessages = [{ ...makeSystemPrologue(1), next: [] }]
      nextRootId = 1
      nextSelected = {}
      nextNextId = 2
      nextChatSettings = {
        model: (nextSettings?.defaultChat?.model) || 'gpt-4o-mini',
        streaming: (typeof nextSettings?.defaultChat?.streaming === 'boolean' ? nextSettings.defaultChat.streaming : true)
      }
      try {
        const mini = (nextMessages || []).map(m => `${m.id}|${m.role}|${m.content?.length||0}|${(Array.isArray(m.next)?m.next.length:0)}`)
        nextPersistSig = JSON.stringify({ m: mini, model: nextChatSettings?.model || '', streaming: !!nextChatSettings?.streaming, rootId: nextRootId, s: nextSelected })
      } catch { nextPersistSig = '' }
      setTimeout(() => {
        try {
          settings = nextSettings
          messages = nextMessages
          nextId = nextNextId
          chatSettings = nextChatSettings
          rootId = nextRootId
          selected = nextSelected
          editingId = null
          editingText = ''
          persistSig = nextPersistSig
        } finally { ready = true }
      }, 0)
    })
  })
  // Load models once if not cached
  import { onMount } from 'svelte'
  let mounted = false
  // Derive locked state from sending flag and any in-flight typing messages
  $effect(() => {
    try {
      locked = !!(sending || (Array.isArray(messages) && messages.some(m => m?.typing)))
    } catch { locked = !!sending }
  })
  onMount(async () => {
    mounted = true
    try {
      const cached = loadModelsCache()
      if (!cached.ids?.length) {
        const fresh = await ensureModels()
        setTimeout(() => { modelIds = fresh.ids || [] }, 0)
      } else {
        setTimeout(() => { modelIds = cached.ids }, 0)
      }
    } catch {}
  })

  // Persist chat content and settings on change
  // Keep the signature non-reactive to avoid effect feedback loops
  let persistSig = ''
  function computePersistSig() {
    try {
      const mini = (messages || []).map(m => `${m.id}|${m.role}|${m.content?.length||0}|${(Array.isArray(m.next)?m.next.length:0)}`)
      return JSON.stringify({ m: mini, model: chatSettings?.model || '', streaming: !!chatSettings?.streaming, rootId, s: selected })
    } catch { return String(Math.random()) }
  }
  // Immediate persistence helper to avoid relying solely on the reactive effect
  async function persistNow() {
    try {
      const cid = props.chatId
      if (!cid || !mounted) return
      // Persist full graph
      const updated = await saveChatContent(cid, { messages, settings: chatSettings, rootId, selected })
      // Update signature to current snapshot so the effect does not double-save
      persistSig = computePersistSig()
      scheduleParentRefresh(updated)
    } catch {}
  }
  // Coalesce and defer parent refresh notification to avoid re-entrant updates
  let refreshScheduled = false
  let refreshTimer = null
  function scheduleParentRefresh(updated) {
    if (refreshScheduled) return
    refreshScheduled = true
    // Defer to a macrotask so it runs after the current flush/reconcile cycle
    refreshTimer && clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshScheduled = false
      refreshTimer = null
      try { props.onChatUpdated?.(updated) } catch {}
    }, 0)
  }
  $effect(() => {
    const cid = props.chatId
    if (!cid || !ready || !mounted) return
    try {
      const sig = computePersistSig()
      if (sig === persistSig) return
      persistSig = sig
      const p = saveChatContent(cid, { messages, settings: chatSettings, rootId, selected })
      p.then(updated => scheduleParentRefresh(updated)).catch(() => {})
    } catch {}
  })

  

  // Send a message (with chosen role) and request an assistant reply via API
  async function sendWithRole(role = 'user') {
    if (locked) return
    const text = input.trim()
    if (!text || sending) return

    sending = true
    // Attach new message as a child of the last visible message
    const visible = buildVisible()
    const last = visible.length ? visible[visible.length - 1].m : null
    const parentId = last ? last.id : null
    const newMsg = { id: nextId++, role, content: text, time: Date.now(), next: [] }
    let arr = messages.slice()
    arr.push(newMsg)
    if (parentId != null) {
      arr = arr.map(m => (m.id === parentId ? { ...m, next: [...(m.next || []), newMsg.id] } : m))
      selected = { ...selected, [parentId]: ((m => (Array.isArray(m.next) ? m.next.length - 1 : 0))(arr.find(mm => mm.id === parentId) || { next: [newMsg.id] })) }
    } else {
      rootId = newMsg.id
    }
    messages = arr
    input = ''
    // Persist immediately after adding the user's message
    persistNow()
    // Composer handles input auto-grow on its own
    // Scroll on send (after appending your message)
    queueMicrotask(() => scrollToBottom())

    // Typing placeholder
    // If user message, add typing assistant child and stream
    if (role === 'user') {
      const typingMsg = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true, next: [] }
      // Attach typing message under the new user message
      messages = messages.map(m => (m.id === newMsg.id ? { ...m, next: [...(m.next || []), typingMsg.id] } : m))
      messages = [...messages, typingMsg]
      selected = { ...selected, [newMsg.id]: ((messages.find(mm => mm.id === newMsg.id)?.next || []).length - 1) }
    }
    try {
      let reply
      // Always read current settings so API key changes apply immediately
      settings = loadSettings()
      const { apiKey } = settings
      if (role === 'user' && apiKey) {
        // Build message history (exclude typing placeholder)
        const history = buildVisible()
          .map(vm => vm.m)
          .filter(m => !m.typing)
          .map(({ role, content }) => ({ role, content }))
        if (chatSettings.streaming) {
          // Stream into the typing message
          reply = await respond({
            messages: history,
            model: chatSettings.model,
            stream: true,
            onTextDelta: (full) => {
              messages = messages.map(m => (m.id === typingMsg.id ? { ...m, content: full } : m))
            }
          })
        } else if (role === 'user') {
          reply = await respond({ messages: history, model: chatSettings.model })
        }
      } else {
        // if no key set, provide a friendly hint + echo
        if (role === 'user') {
          reply = generatePlaceholderReply(newMsg.content) +
            '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
        }
      }
      if (role === 'user') {
        // Update the typing assistant
        const lastChildId = (messages.find(mm => mm.id === newMsg.id)?.next || [])[Number(selected?.[newMsg.id]) || 0]
        messages = messages.map(m => (m.id === lastChildId ? { ...m, content: reply, typing: false, error: undefined } : m))
      }
      // Persist after receiving the assistant reply
      persistNow()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      if (role === 'user') {
        const lastChildId = (messages.find(mm => mm.id === newMsg.id)?.next || [])[Number(selected?.[newMsg.id]) || 0]
        messages = messages.map(m => (m.id === lastChildId
          ? { ...m, typing: false, error: msg, content: (m.content === 'typing' ? '' : m.content) }
          : m))
      }
      persistNow()
    } finally {
      sending = false
      // Do not auto-scroll on reply
    }
  }

  // Default send: as user
  function send() { return sendWithRole('user') }

  // Add a message locally without sending to the API
  function addToChat(role = 'user') {
    if (locked) return
    const text = input.trim()
    if (!text) return
    const direct = { id: nextId++, role, content: text, time: Date.now(), next: [] }
    const visible = buildVisible()
    const last = visible.at(-1)?.m
    let arr = messages.slice()
    arr.push(direct)
    if (last) {
      arr = arr.map(m => (m.id === last.id ? { ...m, next: [...(m.next || []), direct.id] } : m))
      selected = { ...selected, [last.id]: ((arr.find(mm => mm.id === last.id)?.next || []).length - 1) }
    } else {
      rootId = direct.id
    }
    messages = arr
    persistNow()
    input = ''
    queueMicrotask(() => scrollToBottom())
  }

  function generatePlaceholderReply(text) {
    const canned = [
      'Interesting — tell me more.',
      'Noted. What should we try next?',
      'I\'m thinking… maybe break it down?',
      'Got it. Here\'s a simple take:',
      'Okay! A quick summary:'
    ]
    const lead = canned[Math.floor(Math.random() * canned.length)]
    const echo = text.length > 140 ? text.slice(0, 140) + '…' : text
    return `${lead}\n\nYou said: “${echo}”`
  }

  let listCmp
  function scrollToBottom() {
    try { listCmp?.scrollToBottom?.() } catch {}
  }

  // keyboard handling lives in Composer
  // Toggle per-chat settings popover (click to open/close)
  function toggleChatSettings() {
    if (locked) return
    chatSettingsOpen = !chatSettingsOpen
  }
  function closeChatSettings() { chatSettingsOpen = false }
  // Outside click + Escape handled in ChatSettingsPopover
  // When opening the chat settings, refresh datalist from cache (in case Settings changed it)
  $effect(() => {
    if (chatSettingsOpen) {
      try { modelIds = loadModelsCache().ids || [] } catch {}
    }
  })
  // Message actions
  async function copyMessage(text) { try { await copyToClipboard(text) } catch {} }
  function deleteMessage(id) {
    if (locked) return
    // Do not allow deleting the root directly
    if (id === rootId) return
    // Recursively remove subtree
    const toDelete = new Set()
    function collect(nodeId) {
      if (toDelete.has(nodeId)) return
      toDelete.add(nodeId)
      const node = messages.find(m => m.id === nodeId)
      for (const child of node?.next || []) collect(child)
    }
    collect(id)
    // Remove edges from parents and fix selection
    const arr = messages
      .filter(m => !toDelete.has(m.id))
      .map(m => {
        const next = (m.next || []).filter(cid => !toDelete.has(cid))
        let sel = selected?.[m.id]
        if (typeof sel === 'number') {
          const max = Math.max(0, next.length - 1)
          sel = Math.max(0, Math.min(sel, max))
        }
        return { ...m, next }
      })
    messages = arr
    const nextSel = { ...selected }
    for (const key of Object.keys(nextSel)) {
      const mid = Number(key)
      const parent = arr.find(m => m.id === mid)
      if (!parent) { delete nextSel[key]; continue }
      const max = Math.max(0, (parent.next || []).length - 1)
      let val = Number(nextSel[key]) || 0
      if (val > max) nextSel[key] = max
    }
    selected = nextSel
    persistNow()
  }
  function setMessageRole(id, role) {
    if (locked) return
    // Role change should behave like content change: do not alter branching.
    const roles = new Set(['user', 'assistant', 'system'])
    if (!roles.has(role)) return
    messages = messages.map(m => (m.id === id ? { ...m, role } : m))
    persistNow()
    // Do not scroll when switching roles
  }
  // Reorder adjacent messages along the current visible path (graph-aware)
  function moveUp(id) {
    if (locked) return
    const path = buildVisible()
    const idx = path.findIndex(vm => vm.m.id === id)
    if (idx <= 0) return // cannot move the first visible item up
    const B = path[idx]?.m
    const A = path[idx - 1]?.m
    const P = (idx - 2 >= 0) ? path[idx - 2]?.m : null
    const C = path[idx + 1]?.m || null
    if (!A || !B) return
    // Sanity: ensure adjacency A -> B
    const aNode = messages.find(m => m.id === A.id)
    if (!aNode || !Array.isArray(aNode.next) || !aNode.next.includes(B.id)) return

    let arr = messages.slice()
    // Helper: mutate next array for a node id
    function setNext(mid, nextArr) {
      arr = arr.map(m => (m.id === mid ? { ...m, next: nextArr } : m))
    }
    function getNode(mid) { return arr.find(m => m.id === mid) }
    function replaceChild(parentId, fromId, toId) {
      const p = getNode(parentId)
      if (!p) return
      const n = Array.isArray(p.next) ? p.next.slice() : []
      const fromIdx = n.indexOf(fromId)
      if (fromIdx < 0) return
      const toIdx = n.indexOf(toId)
      if (toIdx >= 0 && toIdx !== fromIdx) {
        // Move existing toId to the fromIdx position, remove original fromId
        const nn = n.filter((_, ix) => ix !== fromIdx) // remove fromId
        const withoutTo = nn.filter((x) => x !== toId) // ensure single toId
        const insertAt = Math.min(fromIdx, withoutTo.length)
        withoutTo.splice(insertAt, 0, toId)
        setNext(parentId, withoutTo)
      } else if (toIdx === fromIdx) {
        // Already in place: just ensure single occurrence
        setNext(parentId, [...new Set(n)])
      } else {
        n[fromIdx] = toId
        setNext(parentId, n)
      }
    }
    function removeChild(parentId, childId) {
      const p = getNode(parentId)
      if (!p) return
      const n = (Array.isArray(p.next) ? p.next : []).filter(x => x !== childId)
      setNext(parentId, n)
    }
    function addChild(parentId, childId) {
      const p = getNode(parentId)
      if (!p) return
      const n = Array.isArray(p.next) ? p.next.slice() : []
      if (!n.includes(childId)) { n.push(childId); setNext(parentId, n) }
    }

    // 1) P -> A becomes P -> B (or B becomes new root)
    if (P) {
      replaceChild(P.id, A.id, B.id)
    } else {
      rootId = B.id
    }
    // 2) and 3) Adjust middle edges while preserving child order positions
    // If C exists (A -> B -> C), do in-place replacements to keep indices stable:
    //   - A -> B becomes A -> C (at B's former index)
    //   - B -> C becomes B -> A (at C's former index)
    // Otherwise (no C), remove A -> B and append B -> A.
    if (C) {
      replaceChild(A.id, B.id, C.id)
      replaceChild(B.id, C.id, A.id)
    } else {
      removeChild(A.id, B.id)
      addChild(B.id, A.id)
    }

    // Update selected branch indices to follow the same active branches
    const nextSel = { ...selected }
    // P keeps the same index because we replaced child in-place
    if (B) {
      const bNode = getNode(B.id)
      const bi = Math.max(0, (Array.isArray(bNode?.next) ? bNode.next.indexOf(A.id) : 0))
      nextSel[B.id] = bi
    }
    if (A) {
      const a2 = getNode(A.id)
      if (C) {
        const ai = Math.max(0, (Array.isArray(a2?.next) ? a2.next.indexOf(C.id) : 0))
        nextSel[A.id] = ai
      } else {
        // If no C, keep prior selection clamped
        const max = Math.max(0, (Array.isArray(a2?.next) ? a2.next.length - 1 : 0))
        let prev = Number(nextSel[A.id]) || 0
        if (prev > max) prev = max
        nextSel[A.id] = prev
      }
    }

    messages = arr
    selected = nextSel
    persistNow()
  }
  function moveDown(id) {
    if (locked) return
    const path = buildVisible()
    const idx = path.findIndex(vm => vm.m.id === id)
    if (idx < 0 || idx >= (path.length - 1)) return // cannot move the last visible item down
    const B = path[idx]?.m
    const C = path[idx + 1]?.m
    const P = (idx - 1 >= 0) ? path[idx - 1]?.m : null
    const D = path[idx + 2]?.m || null
    if (!B || !C) return
    // Sanity: ensure adjacency B -> C
    const bNode0 = messages.find(m => m.id === B.id)
    if (!bNode0 || !Array.isArray(bNode0.next) || !bNode0.next.includes(C.id)) return

    let arr = messages.slice()
    function setNext(mid, nextArr) { arr = arr.map(m => (m.id === mid ? { ...m, next: nextArr } : m)) }
    function getNode(mid) { return arr.find(m => m.id === mid) }
    function replaceChild(parentId, fromId, toId) {
      const p = getNode(parentId)
      if (!p) return
      const n = Array.isArray(p.next) ? p.next.slice() : []
      const fromIdx = n.indexOf(fromId)
      if (fromIdx < 0) return
      const toIdx = n.indexOf(toId)
      if (toIdx >= 0 && toIdx !== fromIdx) {
        const nn = n.filter((_, ix) => ix !== fromIdx)
        const withoutTo = nn.filter((x) => x !== toId)
        const insertAt = Math.min(fromIdx, withoutTo.length)
        withoutTo.splice(insertAt, 0, toId)
        setNext(parentId, withoutTo)
      } else if (toIdx === fromIdx) {
        setNext(parentId, [...new Set(n)])
      } else {
        n[fromIdx] = toId
        setNext(parentId, n)
      }
    }
    function removeChild(parentId, childId) {
      const p = getNode(parentId)
      if (!p) return
      const n = (Array.isArray(p.next) ? p.next : []).filter(x => x !== childId)
      setNext(parentId, n)
    }
    function addChild(parentId, childId) {
      const p = getNode(parentId)
      if (!p) return
      const n = Array.isArray(p.next) ? p.next.slice() : []
      if (!n.includes(childId)) { n.push(childId); setNext(parentId, n) }
    }

    // 1) P -> B becomes P -> C (or C becomes new root)
    if (P) {
      replaceChild(P.id, B.id, C.id)
    } else {
      rootId = C.id
    }
    // 2) and 3) Adjust middle edges while preserving child order positions
    // If D exists (B -> C -> D), do in-place replacements to keep indices stable:
    //   - B -> C becomes B -> D (at C's former index)
    //   - C -> D becomes C -> B (at D's former index)
    // Otherwise (no D), remove B -> C and append C -> B.
    if (D) {
      replaceChild(B.id, C.id, D.id)
      replaceChild(C.id, D.id, B.id)
    } else {
      removeChild(B.id, C.id)
      addChild(C.id, B.id)
    }

    // Update selected indices to continue along active branches
    const nextSel = { ...selected }
    if (C) {
      const c2 = getNode(C.id)
      const ci = Math.max(0, (Array.isArray(c2?.next) ? c2.next.indexOf(B.id) : 0))
      nextSel[C.id] = ci
    }
    if (B) {
      const b2 = getNode(B.id)
      if (D) {
        const bi = Math.max(0, (Array.isArray(b2?.next) ? b2.next.indexOf(D.id) : 0))
        nextSel[B.id] = bi
      } else {
        const max = Math.max(0, (Array.isArray(b2?.next) ? b2.next.length - 1 : 0))
        let prev = Number(nextSel[B.id]) || 0
        if (prev > max) prev = max
        nextSel[B.id] = prev
      }
    }

    messages = arr
    selected = nextSel
    persistNow()
  }
  function editMessage(id) {
    if (locked) return
    const msg = messages.find(m => m.id === id)
    if (!msg || msg.typing) return
    editingId = id
    editingText = msg.content || ''
    // Focus/caret handled by MessageBubble when entering edit mode
  }
  function commitEdit() {
    if (locked) return
    if (editingId == null) return
    const val = String(editingText)
    messages = messages.map(m => (m.id === editingId ? { ...m, content: val, error: undefined } : m))
    editingId = null
    editingText = ''
    queueMicrotask(() => scrollToBottom())
    persistNow()
  }
  // Replace the current message content in-place (no branching)
  function applyEditReplace() { commitEdit() }

  // Create a branch for the edited message without generating a new reply
  function applyEditBranch() {
    if (locked) return
    if (editingId == null) return
    const cur = messages.find(m => m.id === editingId)
    if (!cur) return
    const val = String(editingText)
    const parentId = findParentId(messages, cur.id)
    // Create a sibling branch under the same parent and select it
    const newNode = { id: nextId++, role: cur.role, content: val, time: Date.now(), next: Array.isArray(cur.next) ? cur.next.slice() : [] }
    let arr = messages.slice()
    arr.push(newNode)
    if (parentId != null) {
      arr = arr.map(m => (m.id === parentId ? { ...m, next: [...(m.next || []), newNode.id] } : m))
      selected = { ...selected, [parentId]: ((arr.find(mm => mm.id === parentId)?.next || []).length - 1) }
    } else {
      // If no parent, branch at root (replace root selection)
      rootId = newNode.id
    }
    messages = arr
    persistNow()
    editingId = null
    editingText = ''
    queueMicrotask(() => scrollToBottom())
  }

  // Branch and generate a new assistant reply starting after the edited message
  async function applyEditSend() {
    if (locked) return
    if (editingId == null) return
    const cur = messages.find(m => m.id === editingId)
    if (!cur) return
    const val = String(editingText)
    // 1) Branch the edited message (create sibling under same parent) and select it
    const parentId = findParentId(messages, cur.id)
    const branched = { id: nextId++, role: cur.role, content: val, time: Date.now(), next: [] }
    let arr = messages.slice()
    arr.push(branched)
    if (parentId != null) {
      arr = arr.map(m => (m.id === parentId ? { ...m, next: [...(m.next || []), branched.id] } : m))
      selected = { ...selected, [parentId]: ((arr.find(mm => mm.id === parentId)?.next || []).length - 1) }
    } else {
      rootId = branched.id
    }
    messages = arr
    persistNow()
    editingId = null
    editingText = ''

    // 2) Generate a new assistant reply after the branched message
    const typingMsg = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true, next: [] }
    messages = messages.map(m => (m.id === branched.id ? { ...m, next: [...(m.next || []), typingMsg.id] } : m))
    messages = [...messages, typingMsg]
    selected = { ...selected, [branched.id]: ((messages.find(mm => mm.id === branched.id)?.next || []).length - 1) }
    
    try {
      let reply
      settings = loadSettings()
      const { apiKey } = settings
      // Build history up to and including branched message
      const path = buildVisible()
      const insertIndex = path.findIndex(vm => vm.m.id === branched.id)
      const history = buildVisibleUpTo(insertIndex + 1)
        .filter(m => !m.typing)
        .map(({ role, content }) => ({ role, content }))
      if (apiKey) {
        if (chatSettings.streaming) {
          reply = await respond({
            messages: history,
            model: chatSettings.model,
            stream: true,
            onTextDelta: (full) => {
              messages = messages.map(m => (m.id === typingMsg.id ? { ...m, content: full } : m))
            }
          })
        } else {
          reply = await respond({ messages: history, model: chatSettings.model })
        }
      } else {
        const lastUser = [...buildVisibleUpTo(insertIndex + 1)].reverse().find(m => m.role === 'user')
        reply = generatePlaceholderReply(lastUser?.content || val) +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      messages = messages.map(m => (m.id === typingMsg.id ? { ...m, content: reply, typing: false, error: undefined } : m))
      persistNow()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      messages = messages.map(m => (m.id === typingMsg.id
        ? { ...m, typing: false, error: msg, content: (m.content === 'typing' ? '' : m.content) }
        : m))
      persistNow()
    } finally {
      // Do not auto-scroll on reply
    }
  }
  function cancelEdit() {
    editingId = null
    editingText = ''
  }

  

  // Removed global auto-scroll effect to avoid scrolling on replies/role changes

  // Branch: regenerate an assistant message by creating a new branch
  async function refreshAssistant(id) {
    if (locked) return
    const target = messages.find(m => m.id === id)
    if (!target || target.role !== 'assistant' || target.typing) return
    const parentId = findParentId(messages, id)
    if (parentId == null) return
    // Create a new assistant branch under the same parent and stream into it
    const typingMsg = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true, next: [] }
    let arr = messages.slice()
    arr.push(typingMsg)
    arr = arr.map(m => (m.id === parentId ? { ...m, next: [...(m.next || []), typingMsg.id] } : m))
    messages = arr
    selected = { ...selected, [parentId]: ((arr.find(mm => mm.id === parentId)?.next || []).length - 1) }
    try {
      let reply
      settings = loadSettings()
      const { apiKey } = settings
      if (apiKey) {
        // Build history up to (but not including) this assistant message (parent path)
        const path = buildVisible()
        const parentPathIndex = path.findIndex(vm => vm.m.id === parentId)
        const history = buildVisibleUpTo(parentPathIndex + 1)
          .filter(m => !m.typing)
          .map(({ role, content }) => ({ role, content }))
        if (chatSettings.streaming) {
          reply = await respond({
            messages: history,
            model: chatSettings.model,
            stream: true,
            onTextDelta: (full) => {
              messages = messages.map(m => (m.id === typingMsg.id ? { ...m, content: full } : m))
            }
          })
        } else {
          reply = await respond({ messages: history, model: chatSettings.model })
        }
      } else {
        // No key: generate a placeholder reply based on last user input
        const path = buildVisible()
        const lastUser = [...path.map(vm => vm.m)].reverse().find(m => m.role === 'user')
        reply = generatePlaceholderReply(lastUser?.content || 'Regenerated response') +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      messages = messages.map(m => (m.id === typingMsg.id ? { ...m, typing: false, error: undefined, content: reply } : m))
      persistNow()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      messages = messages.map(m => (m.id === typingMsg.id ? { ...m, typing: false, error: msg, content: (m.content === 'typing' ? '' : m.content) } : m))
      persistNow()
    } finally {
      // Do not auto-scroll on reply
    }
  }

  // Generate a new assistant reply directly after a given user message index
  // (used when refreshing a user message with no following assistant)
  async function refreshAfterUserIndex(i) {
    if (locked) return
    const path = buildVisible()
    const vm = (typeof i === 'number') ? path[i] : null
    const cur = vm?.m
    if (!cur || cur.role !== 'user') return
    // Add typing assistant as a child under this user
    const typingMsg = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true, next: [] }
    messages = messages.map(m => (m.id === cur.id ? { ...m, next: [...(m.next || []), typingMsg.id] } : m))
    messages = [...messages, typingMsg]
    selected = { ...selected, [cur.id]: ((messages.find(mm => mm.id === cur.id)?.next || []).length - 1) }
    persistNow()

    try {
      let reply
      settings = loadSettings()
      const { apiKey } = settings
      const history = buildVisibleUpTo(i + 1)
        .filter(m => !m.typing)
        .map(({ role, content }) => ({ role, content }))
      if (apiKey) {
        if (chatSettings.streaming) {
          reply = await respond({
            messages: history,
            model: chatSettings.model,
            stream: true,
            onTextDelta: (full) => {
              messages = messages.map(m => (m.id === typingMsg.id ? { ...m, content: full } : m))
            }
          })
        } else {
          reply = await respond({ messages: history, model: chatSettings.model })
        }
      } else {
        const lastUser = [...buildVisibleUpTo(i + 1)].reverse().find(m => m.role === 'user')
        reply = generatePlaceholderReply(lastUser?.content || cur.content) +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      messages = messages.map(m => (m.id === typingMsg.id ? { ...m, content: reply, typing: false, error: undefined } : m))
      persistNow()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      messages = messages.map(m => (m.id === typingMsg.id ? { ...m, typing: false, error: msg, content: (m.content === 'typing' ? '' : m.content) } : m))
      persistNow()
    } finally {
      // Do not auto-scroll on reply
    }
  }
  
  function changeVariant(id, delta) {
    if (locked) return
    // Change selected child branch for a message id
    const parent = messages.find(m => m.id === id)
    if (!parent || !Array.isArray(parent.next) || parent.next.length <= 1) return
    const len = parent.next.length
    const cur = Number(selected?.[id]) || 0
    const next = Math.max(0, Math.min(len - 1, cur + delta))
    if (next === cur) return
    selected = { ...selected, [id]: next }
    persistNow()
  }
</script>

<section class="chat-shell">
  <MessageList
    bind:this={listCmp}
    items={buildVisible()}
    total={messages.length}
    locked={locked}
    editingId={editingId}
    editingText={editingText}
    selectedMap={selected}
    followingMap={computeFollowingMap()}
    onSetRole={(id, role) => setMessageRole(id, role)}
    onEditInput={(t) => onEditableInput(t)}
    onEditKeydown={onEditableKeydown}
    onApplyEditSend={applyEditSend}
    onApplyEditBranch={applyEditBranch}
    onApplyEditReplace={applyEditReplace}
    onCancelEdit={cancelEdit}
    onChangeVariant={(id, d) => changeVariant(id, d)}
    onRefreshAssistant={(id) => refreshAssistant(id)}
    onRefreshAfterUserIndex={(i) => refreshAfterUserIndex(i)}
    onCopy={(text) => copyMessage(text)}
    onDelete={(id) => deleteMessage(id)}
    onEdit={(id) => editMessage(id)}
    onMoveDown={(id) => moveDown(id)}
    onMoveUp={(id) => moveUp(id)}
  />

  <Composer
    input={input}
    sending={sending}
    locked={locked}
    chatSettingsOpen={chatSettingsOpen}
    chatModel={chatSettings.model}
    chatStreaming={chatSettings.streaming}
    modelIds={modelIds}
    onToggleChatSettings={toggleChatSettings}
    onCloseChatSettings={() => (chatSettingsOpen = false)}
    onChangeModel={(val) => (chatSettings = { ...chatSettings, model: val })}
    onChangeStreaming={(val) => (chatSettings = { ...chatSettings, streaming: !!val })}
    onInput={(val) => (input = val)}
    onAdd={(role) => addToChat(role)}
    onSend={(role) => sendWithRole(role)}
  />

  
</section>

<style>
  /* Grayscale UI with accent reserved for buttons */
  .chat-shell {
    --bg: color-mix(in oklab, canvas, #f3f4f6 10%);
    --panel: color-mix(in srgb, #ffffff 92%, #e6e6e6);
    --border: color-mix(in srgb, #c8c8c8 60%, #0000);
    --text: color-mix(in srgb, #1b1f24 92%, #0000);
    --muted: #6b7280;
    --accent: #3584e4; /* Accent reserved for actionable buttons */
    --assistant: #f3f4f6; /* neutral gray */
    --user: #e5e7eb;      /* neutral gray (no color) */

    /* Layout + floaty look */
    --page-gutter: clamp(14px, 4vw, 32px);
    --page-max: 980px;
    --float-shadow: 0 10px 30px rgba(0,0,0,0.08), 0 2px 10px rgba(0,0,0,0.06);
    --float-border: color-mix(in srgb, var(--border), transparent 55%);
    --bubble-pad-x: 12px; /* bubble text horizontal padding */
    /* Action buttons sit 4px closer than text padding on the button side */
    --actions-inset-x: clamp(0px, calc(var(--bubble-pad-x) - 4px), 100vw);
  }

  @media (prefers-color-scheme: dark) {
    .chat-shell {
      /* Neutral grays only */
      --bg: #0f0f10;
      --panel: #141414;
      --border: #2a2a2a;
      --text: #e6e6e6;
      --muted: #a3a3a3;
      --assistant: #1c1c1c;
      --user: #222222;
    }
  }

  .chat-shell {
    height: 100%;
    display: grid;
    grid-template-rows: 1fr auto;
    background: var(--bg);
    color: var(--text);
    padding-inline: var(--page-gutter);
    padding-top: 0;
    padding-bottom: 0;
    overflow-x: hidden;
  }


  /* .messages block removed: styled in MessageList.svelte */
  /* .row* classes removed: styled in MessageItem.svelte */

  /* .stack* classes removed: styled in MessageItem.svelte */

  /* .meta* classes removed: styled in MessageMeta.svelte */

  /* Role badge/menu styles removed: styled in MessageMeta.svelte */

  /* Bubble styles removed: styled in MessageBubble.svelte */

  /* Bubble editor styles removed: handled in MessageBubble.svelte */

  /* Action row styles removed: styled in MessageActions.svelte */

  /* Composer styles removed: styled in Composer.svelte */

  /* Send menu styles removed: styled where used */

  /* Per-chat settings menu styles removed: styled in ChatSettingsPopover.svelte */

  /* Typing indicator styles removed: styled in MessageBubble.svelte */
</style>
