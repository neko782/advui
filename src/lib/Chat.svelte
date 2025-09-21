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
  let nextId = $state(1)
  let settings = $state(loadSettings())
  // Group per-chat settings in a single object (seeded from global defaults)
  let chatSettings = $state({
    model: (settings?.defaultChat?.model) || 'gpt-4o-mini',
  })
  // Per-chat settings popover open state
  let chatSettingsOpen = $state(false)
  // Cached models (for datalist)
  let modelIds = $state(loadModelsCache().ids || [])
  let editingId = $state(null)
  let editingText = $state('')
  // editing DOM is handled in MessageBubble
  // Branching helpers
  import { isAnchor, buildVisible as _buildVisible, buildVisibleUpTo as _buildVisibleUpTo, chainFromVisibleUpTo as _chainFromVisibleUpTo, currentVisibleChain as _currentVisibleChain, injectAnchorToken } from './branching.js'
  function buildVisible() { return _buildVisible(messages) }
  function buildVisibleUpTo(indexExclusive) { return _buildVisibleUpTo(messages, indexExclusive) }
  function currentVisibleChain() { return _currentVisibleChain(messages) }
  function chainFromVisibleUpTo(indexExclusive) { return _chainFromVisibleUpTo(messages, indexExclusive) }
  function computeFollowingMap() {
    const map = {}
    for (let i = 0; i < messages.length; i++) {
      const next = messages[i + 1]
      if (next && next.role === 'assistant') {
        map[i] = { has: true, id: next.id, typing: !!next.typing }
      } else {
        map[i] = { has: false, id: null, typing: false }
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
    let nextSettings = loadSettings()
    let nextChatSettings = { model: (nextSettings?.defaultChat?.model) || 'gpt-4o-mini' }
    let nextNextId = 1
    let nextPersistSig = ''
    try {
      const loaded = loadChatById(cid)
      if (loaded) {
        nextMessages = Array.isArray(loaded.messages) ? loaded.messages.slice() : []
        nextChatSettings = { model: loaded?.settings?.model || (nextSettings?.defaultChat?.model) || 'gpt-4o-mini' }
        if (!nextMessages.length) {
          nextNextId = 2
          nextMessages = [makeSystemPrologue(1)]
        } else {
          try {
            const maxId = (nextMessages || []).reduce((mx, m) => Math.max(mx, Number(m?.id) || 0), 0)
            nextNextId = maxId + 1
          } catch { nextNextId = 1 }
        }
      } else {
        nextMessages = [makeSystemPrologue(1)]
        nextNextId = 2
        nextChatSettings = { model: (nextSettings?.defaultChat?.model) || 'gpt-4o-mini' }
      }
    } catch {
      nextSettings = loadSettings()
      nextMessages = [makeSystemPrologue(1)]
      nextNextId = 2
      nextChatSettings = { model: (nextSettings?.defaultChat?.model) || 'gpt-4o-mini' }
    }
    // Precompute a persist signature for the loaded chat content
    try {
      const mini = (nextMessages || []).map(m => `${m.id}|${m.role}|${m.content?.length||0}|${m.variantIndex||0}`)
      nextPersistSig = JSON.stringify({ m: mini, model: nextChatSettings?.model || '' })
    } catch { nextPersistSig = '' }
    // Apply computed state after the current tick
    setTimeout(() => {
      try {
        settings = nextSettings
        messages = nextMessages
        nextId = nextNextId
        chatSettings = nextChatSettings
        editingId = null
        editingText = ''
        // Align persistence signature to loaded state
        persistSig = nextPersistSig
      } finally {
        ready = true
      }
    }, 0)
  })
  // Load models once if not cached
  import { onMount } from 'svelte'
  let mounted = false
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
      const mini = (messages || []).map(m => `${m.id}|${m.role}|${m.content?.length||0}|${m.variantIndex||0}`)
      return JSON.stringify({ m: mini, model: chatSettings?.model || '' })
    } catch { return String(Math.random()) }
  }
  // Immediate persistence helper to avoid relying solely on the reactive effect
  function persistNow() {
    try {
      const cid = props.chatId
      if (!cid || !mounted) return
      const updated = saveChatContent(cid, { messages, settings: chatSettings })
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
      const updated = saveChatContent(cid, { messages, settings: chatSettings })
      // Notify parent (App) to refresh list/sidebar (titles/order) after commit
      scheduleParentRefresh(updated)
    } catch {}
  })

  

  // Send a message (with chosen role) and request an assistant reply via API
  async function sendWithRole(role = 'user') {
    const text = input.trim()
    if (!text || sending) return

    sending = true
    const parentChain = currentVisibleChain()
    const firstMsg = { id: nextId++, role, content: text, time: Date.now(), branchPath: parentChain }
    messages = [...messages, firstMsg]
    input = ''
    // Persist immediately after adding the user's message
    persistNow()
    // Composer handles input auto-grow on its own
    // Scroll on send (after appending your message)
    queueMicrotask(() => scrollToBottom())

    // Typing placeholder
    const typingMsg = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true }
    messages = [...messages, typingMsg]
    try {
      let reply
      // Always read current settings so API key changes apply immediately
      settings = loadSettings()
      const { apiKey } = settings
      if (apiKey) {
        // Build message history (exclude typing placeholder)
        const history = buildVisible()
          .map(vm => vm.m)
          .filter(m => !m.typing)
          .map(({ role, content }) => ({ role, content }))
        reply = await respond({ messages: history, model: chatSettings.model })
      } else {
        // if no key set, provide a friendly hint + echo
        reply = generatePlaceholderReply(firstMsg.content) +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      messages = messages.map(m => (m.id === typingMsg.id ? { ...m, content: reply, typing: false, variants: [reply], variantIndex: 0, branchPathBefore: parentChain } : m))
      // Persist after receiving the assistant reply
      persistNow()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      const errText = `Error: ${msg}`
      messages = messages.map(m => (m.id === typingMsg.id ? { ...m, content: errText, typing: false, variants: [errText], variantIndex: 0, branchPathBefore: parentChain } : m))
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
    const text = input.trim()
    if (!text) return
    const parentChain = currentVisibleChain()
    const direct = role === 'assistant'
      ? { id: nextId++, role, content: text, time: Date.now(), variants: [text], variantIndex: 0, branchPathBefore: parentChain }
      : { id: nextId++, role, content: text, time: Date.now(), branchPath: parentChain }
    messages = [...messages, direct]
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
    messages = messages.filter(m => m.id !== id)
    persistNow()
  }
  function setMessageRole(id, role) {
    // Role change should behave like content change: do not alter branching.
    const roles = new Set(['user', 'assistant', 'system'])
    if (!roles.has(role)) return
    messages = messages.map(m => (m.id === id ? { ...m, role } : m))
    persistNow()
    // Do not scroll when switching roles
  }
  // Align a message's branching metadata to the chain at its current index
  function alignMessageToChainAt(arr, idx) {
    const m = arr[idx]
    if (!m) return m
    const parentChain = _chainFromVisibleUpTo(arr, idx)
    if (isAnchor(m)) {
      // Anchored messages (assistant or branched user/system) gate visibility via branchPathBefore
      return { ...m, branchPathBefore: parentChain }
    }
    // Only update branchPath for messages that already participate in branching
    if (Object.prototype.hasOwnProperty.call(m, 'branchPath')) {
      return { ...m, branchPath: parentChain }
    }
    return m
  }
  // After any reorder, re-sync branching metadata across the entire list
  function realignAll(arr) {
    const out = arr.slice()
    for (let k = 0; k < out.length; k++) {
      out[k] = alignMessageToChainAt(out, k)
    }
    return out
  }
  function moveUp(id) {
    const i = messages.findIndex(m => m.id === id)
    if (i > 0) {
      const arr = messages.slice()
      ;[arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]
      // Re-sync branching across the entire list to maintain visibility
      messages = realignAll(arr)
      persistNow()
    }
  }
  function moveDown(id) {
    const i = messages.findIndex(m => m.id === id)
    if (i >= 0 && i < messages.length - 1) {
      const arr = messages.slice()
      ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
      // Re-sync branching across the entire list to maintain visibility
      messages = realignAll(arr)
      persistNow()
    }
  }
  function editMessage(id) {
    const msg = messages.find(m => m.id === id)
    if (!msg || msg.typing) return
    editingId = id
    editingText = msg.content || ''
    // Focus/caret handled by MessageBubble when entering edit mode
  }
  function commitEdit() {
    if (editingId == null) return
    const val = String(editingText)
    messages = messages.map(m => {
      if (m.id !== editingId) return m
      if (m.role === 'assistant' && Array.isArray(m.variants) && typeof m.variantIndex === 'number') {
        const arr = m.variants.slice()
        const idx = Math.max(0, Math.min(arr.length - 1, m.variantIndex || 0))
        arr[idx] = val
        return { ...m, content: val, variants: arr }
      }
      return { ...m, content: val }
    })
    editingId = null
    editingText = ''
    queueMicrotask(() => scrollToBottom())
    persistNow()
  }
  // Replace the current message content in-place (no branching)
  function applyEditReplace() { commitEdit() }

  // Create a branch for the edited message without generating a new reply
  function applyEditBranch() {
    if (editingId == null) return
    const i = messages.findIndex(m => m.id === editingId)
    if (i < 0) return
    const val = String(editingText)
    const cur = messages[i]
    // Assistant: add a new variant with edited content and switch to it
    if (cur.role === 'assistant') {
      const base = Array.isArray(cur.variants) ? cur.variants.slice() : [cur.content]
      base.push(val)
      const vi = base.length - 1
      messages = messages.map((m, idx) => idx === i ? { ...m, content: val, variants: base, variantIndex: vi } : m)
      editingId = null
      editingText = ''
      queueMicrotask(() => scrollToBottom())
      return
    }
    // For user/system: make the message itself an anchor (variants) and select the new variant.
    const parent = chainFromVisibleUpTo(i)
    // Prepare variants
    const base = Array.isArray(cur.variants) ? cur.variants.slice() : [cur.content]
    base.push(val)
    const vi = base.length - 1
    // Update the edited message into an anchor with branchPathBefore
    let arr = messages.slice()
    arr[i] = { ...cur, content: val, variants: base, variantIndex: vi, branchPathBefore: parent }
    // Inject token for downstream branch paths and anchor parents
    messages = injectAnchorToken(arr, i, parent, arr[i].id, 0)
    persistNow()
    editingId = null
    editingText = ''
    queueMicrotask(() => scrollToBottom())
  }

  // Branch and generate a new assistant reply starting after the edited message
  async function applyEditSend() {
    if (editingId == null) return
    const i0 = messages.findIndex(m => m.id === editingId)
    if (i0 < 0) return
    const val = String(editingText)
    const cur = messages[i0]
    // Assistant: branch (selector on assistant), replace with edited content, then generate a new assistant after it
    if (cur.role === 'assistant') {
      // 1) Branch + replace content on the assistant itself
      const parentChainA = chainFromVisibleUpTo(i0)
      messages = messages.map((m, idx) => {
        if (idx !== i0) return m
        const arr = Array.isArray(m.variants) ? m.variants.slice() : [m.content]
        arr.push(val)
        const vi = arr.length - 1
        return { ...m, content: val, variants: arr, variantIndex: vi, branchPathBefore: m.branchPathBefore ?? parentChainA }
      })
      // Exit editing state now that the edit is applied
      editingId = null
      editingText = ''

      // 2) Generate a new assistant message directly after the edited assistant
      const insertIndex = i0
      const parentChainB = chainFromVisibleUpTo(insertIndex + 1)
      const typingMsg = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true, variants: [''], variantIndex: 0, branchPathBefore: parentChainB }
      let arr2 = messages.slice()
      arr2.splice(insertIndex + 1, 0, typingMsg)
      messages = arr2
      persistNow()

      try {
        let reply
        settings = loadSettings()
        const { apiKey } = settings
        const history = buildVisibleUpTo(insertIndex + 1)
          .filter(m => !m.typing)
          .map(({ role, content }) => ({ role, content }))
        if (apiKey) {
          reply = await respond({ messages: history, model: chatSettings.model })
        } else {
          const lastUser = [...buildVisibleUpTo(insertIndex + 1)].reverse().find(m => m.role === 'user')
          reply = generatePlaceholderReply(lastUser?.content || val) +
            '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
        }
        messages = messages.map(m => (m.id === typingMsg.id
          ? { ...m, content: reply, typing: false, variants: [reply], variantIndex: 0 }
          : m))
        persistNow()
      } catch (err) {
        const msg = err?.message || 'Something went wrong.'
        const errText = `Error: ${msg}`
        messages = messages.map(m => (m.id === typingMsg.id
          ? { ...m, content: errText, typing: false, variants: [errText], variantIndex: 0 }
          : m))
        persistNow()
      } finally {
        // Do not auto-scroll on reply
      }
      return
    }
    // For user/system: turn the message into an anchor and generate a fresh assistant reply for the new branch.
    const parent = chainFromVisibleUpTo(i0)
    let arr = messages.slice()
    const base = Array.isArray(cur.variants) ? cur.variants.slice() : [cur.content]
    base.push(val)
    const vi = base.length - 1
    arr[i0] = { ...cur, content: val, variants: base, variantIndex: vi, branchPathBefore: parent }
    // Inject token downstream and update messages
    messages = injectAnchorToken(arr, i0, parent, arr[i0].id, 0)
    persistNow()
    editingId = null
    editingText = ''

    // Insert typing placeholder after the edited message (in new chain)
    const typingMsg = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true }
    arr = messages.slice()
    const insertIndex = i0
    arr.splice(i0 + 1, 0, typingMsg)
    messages = arr
    persistNow()

    try {
      let reply
      settings = loadSettings()
      const { apiKey } = settings
      const history = buildVisibleUpTo(insertIndex + 1)
        .filter(m => !m.typing)
        .map(({ role, content }) => ({ role, content }))
      if (apiKey) {
        reply = await respond({ messages: history, model: chatSettings.model })
      } else {
        const lastUser = [...buildVisibleUpTo(insertIndex + 1)].reverse().find(m => m.role === 'user')
        reply = generatePlaceholderReply(lastUser?.content || val) +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      const parentChain = chainFromVisibleUpTo(insertIndex + 1)
      messages = messages.map(m => (m.id === typingMsg.id
        ? { ...m, content: reply, typing: false, variants: [reply], variantIndex: 0, branchPathBefore: parentChain }
        : m))
      persistNow()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      const errText = `Error: ${msg}`
      const parentChain = chainFromVisibleUpTo(insertIndex + 1)
      messages = messages.map(m => (m.id === typingMsg.id
        ? { ...m, content: errText, typing: false, variants: [errText], variantIndex: 0, branchPathBefore: parentChain }
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

  // Branching: regenerate an assistant message and keep variants locally
  async function refreshAssistant(id) {
    const idx = messages.findIndex(m => m.id === id)
    if (idx < 0) return
    const target = messages[idx]
    if (!target || target.role !== 'assistant' || target.typing) return

    // Determine the parent chain up to (but not including) this assistant
    const parentChain = chainFromVisibleUpTo(idx)

    // Mark as typing on the target message and preselect a new variant index
    // so off-branch messages hide immediately.
    messages = messages.map(m => {
      if (m.id !== id) return m
      const base = Array.isArray(m.variants) ? m.variants.slice() : [m.content]
      const nextIndex = base.length
      // Add a placeholder slot for the in-flight variant so counts line up
      base.push('')
      // Ensure this assistant is anchored to its parent chain
      return { ...m, typing: true, variants: base, variantIndex: nextIndex, branchPathBefore: parentChain }
    })
    try {
      let reply
      settings = loadSettings()
      const { apiKey } = settings
      if (apiKey) {
        // Build history up to (but not including) this assistant message
        const history = buildVisibleUpTo(idx)
          .filter(m => !m.typing)
          .map(({ role, content }) => ({ role, content }))
        reply = await respond({ messages: history, model: chatSettings.model })
      } else {
        // No key: generate a placeholder reply based on last user input
        const lastUser = [...messages.slice(0, idx)].reverse().find(m => m.role === 'user')
        reply = generatePlaceholderReply(lastUser?.content || 'Regenerated response') +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      messages = messages.map(m => {
        if (m.id !== id) return m
        const arr = Array.isArray(m.variants) ? m.variants.slice() : [m.content]
        const vi = typeof m.variantIndex === 'number' ? m.variantIndex : arr.length
        // Ensure the slot exists, then fill it with reply
        if (vi >= arr.length) arr.length = vi + 1
        arr[vi] = reply
        return { ...m, typing: false, content: reply, variants: arr, variantIndex: vi, branchPathBefore: parentChain }
      })
      persistNow()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      const errText = `Error: ${msg}`
      messages = messages.map(m => {
        if (m.id !== id) return m
        const arr = Array.isArray(m.variants) ? m.variants.slice() : [m.content]
        const vi = typeof m.variantIndex === 'number' ? m.variantIndex : arr.length
        if (vi >= arr.length) arr.length = vi + 1
        arr[vi] = errText
        return { ...m, typing: false, content: errText, variants: arr, variantIndex: vi, branchPathBefore: parentChain }
      })
      persistNow()
    } finally {
      // Do not auto-scroll on reply
    }
  }

  // Generate a new assistant reply directly after a given user message index
  // (used when refreshing a user message with no following assistant)
  async function refreshAfterUserIndex(i) {
    if (i == null || i < 0 || i >= messages.length) return
    const cur = messages[i]
    if (!cur || cur.role !== 'user') return
    // If an assistant already follows, delegate to refreshAssistant
    const next = messages[i + 1]
    if (next && next.role === 'assistant') {
      return refreshAssistant(next.id)
    }
    const insertIndex = i
    const parentChain = chainFromVisibleUpTo(insertIndex + 1)
    // Insert a typing assistant anchor immediately so off-branch messages hide now
    const typingMsg = {
      id: nextId++,
      role: 'assistant',
      content: 'typing',
      time: Date.now(),
      typing: true,
      variants: [''],
      variantIndex: 0,
      branchPathBefore: parentChain
    }
    const arr = messages.slice()
    arr.splice(insertIndex + 1, 0, typingMsg)
    messages = arr
    persistNow()

    try {
      let reply
      settings = loadSettings()
      const { apiKey } = settings
      const history = buildVisibleUpTo(insertIndex + 1)
        .filter(m => !m.typing)
        .map(({ role, content }) => ({ role, content }))
      if (apiKey) {
        reply = await respond({ messages: history, model: chatSettings.model })
      } else {
        const lastUser = [...buildVisibleUpTo(insertIndex + 1)].reverse().find(m => m.role === 'user')
        reply = generatePlaceholderReply(lastUser?.content || cur.content) +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      messages = messages.map(m => (m.id === typingMsg.id
        ? { ...m, content: reply, typing: false, variants: [reply], variantIndex: 0 }
        : m))
      persistNow()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      const errText = `Error: ${msg}`
      messages = messages.map(m => (m.id === typingMsg.id
        ? { ...m, content: errText, typing: false, variants: [errText], variantIndex: 0 }
        : m))
      persistNow()
    } finally {
      // Do not auto-scroll on reply
    }
  }

  function changeVariant(id, delta) {
    const i = messages.findIndex(m => m.id === id)
    if (i < 0) return
    const m = messages[i]
    if (!isAnchor(m) || !Array.isArray(m.variants) || !m.variants.length) return
    const len = m.variants.length
    const cur = typeof m.variantIndex === 'number' ? m.variantIndex : 0
    const next = Math.max(0, Math.min(len - 1, cur + delta))
    if (next === cur) return
    const updated = { ...m, variantIndex: next, content: m.variants[next] }
    const arr = messages.slice()
    arr[i] = updated
    messages = arr
    persistNow()
  }
</script>

<section class="chat-shell">
  <MessageList
    bind:this={listCmp}
    items={buildVisible()}
    total={messages.length}
    editingId={editingId}
    editingText={editingText}
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
    chatSettingsOpen={chatSettingsOpen}
    chatModel={chatSettings.model}
    modelIds={modelIds}
    onToggleChatSettings={toggleChatSettings}
    onCloseChatSettings={() => (chatSettingsOpen = false)}
    onChangeModel={(val) => (chatSettings = { ...chatSettings, model: val })}
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

  /* Top bar styles live in TopBar.svelte */

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
