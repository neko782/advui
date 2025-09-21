<script>
  // Svelte 5 runes API
  import Icon from './Icon.svelte'
  import SettingsModal from './SettingsModal.svelte'
  import { loadSettings } from './settingsStore.js'
  import { ensureModels, loadModelsCache } from './modelsStore.js'
  import { respond } from './openaiClient.js'
  import { autoGrow, placeCaretAtEnd } from './utils/dom.js'
  import { copyText as copyToClipboard } from './utils/clipboard.js'
  import { formatRole } from './utils/format.js'
  import { renderMarkdown } from './utils/markdown.js'
  import TopBar from './components/chat/TopBar.svelte'
  import MessageList from './components/chat/MessageList.svelte'
  import Composer from './components/chat/Composer.svelte'

  let messages = $state([])
  let input = $state('')
  let sending = $state(false)
  let nextId = $state(1)
  let showSettings = $state(false)
  let settings = $state(loadSettings())
  // Per-chat setting: model (seed from global once; user can change per chat)
  let chatModel = $state(loadSettings().model || 'gpt-4o-mini')
  // Per-chat settings popover open state
  let chatSettingsOpen = $state(false)
  let chatSettingsEl
  // Cached models (for datalist)
  let modelIds = $state(loadModelsCache().ids || [])
  let editingId = $state(null)
  let editingText = $state('')
  let editingEl
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
  function onEditablePaste(e) {
    // Force paste as plain text
    try {
      const text = e.clipboardData?.getData('text/plain')
      if (text != null) {
        e.preventDefault()
        document.execCommand('insertText', false, text)
      }
    } catch {}
  }

  // Seed each chat with a system prologue
  function addSystemPrologue() {
    const sysMsg = {
      id: nextId++,
      role: 'system',
      content: 'You are a helpful assistant.',
      time: Date.now()
    }
    messages = [sysMsg]
  }

  function newChat() {
    messages = []
    nextId = 1
    addSystemPrologue()
  }

  // Initialize on load
  addSystemPrologue()
  // Load models once if not cached
  import { onMount } from 'svelte'
  onMount(async () => {
    try {
      const cached = loadModelsCache()
      if (!cached.ids?.length) {
        const fresh = await ensureModels()
        modelIds = fresh.ids || []
      } else {
        modelIds = cached.ids
      }
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
    // Refresh input height after clearing
    queueMicrotask(() => autoGrow(inputEl))

    // Typing placeholder
    const typingMsg = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true }
    messages = [...messages, typingMsg]
    try {
      let reply
      const { apiKey } = settings
      if (apiKey) {
        // Build message history (exclude typing placeholder)
        const history = buildVisible()
          .map(vm => vm.m)
          .filter(m => !m.typing)
          .map(({ role, content }) => ({ role, content }))
        reply = await respond({ messages: history, model: chatModel })
      } else {
        // if no key set, provide a friendly hint + echo
        reply = generatePlaceholderReply(firstMsg.content) +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      messages = messages.map(m => (m.id === typingMsg.id ? { ...m, content: reply, typing: false, variants: [reply], variantIndex: 0, branchPathBefore: parentChain } : m))
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      const errText = `Error: ${msg}`
      messages = messages.map(m => (m.id === typingMsg.id ? { ...m, content: errText, typing: false, variants: [errText], variantIndex: 0, branchPathBefore: parentChain } : m))
    } finally {
      sending = false
      // Auto scroll to bottom after response
      queueMicrotask(() => scrollToBottom())
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
    input = ''
    queueMicrotask(() => autoGrow(inputEl))
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
  let inputEl
  function scrollToBottom() {
    try { listCmp?.scrollToBottom?.() } catch {}
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }
  // Toggle per-chat settings popover (click to open/close)
  function toggleChatSettings() {
    chatSettingsOpen = !chatSettingsOpen
  }
  function closeChatSettings() { chatSettingsOpen = false }
  // Close chat settings when clicking outside or pressing Escape
  $effect(() => {
    function onDocClick(e) {
      try {
        const el = chatSettingsEl
        if (!el) return
        if (chatSettingsOpen && !el.contains(e.target)) {
          chatSettingsOpen = false
        }
      } catch {}
    }
    function onKeydown(e) {
      if (e.key === 'Escape' && chatSettingsOpen) {
        chatSettingsOpen = false
      }
    }
    window.addEventListener('click', onDocClick, true)
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('click', onDocClick, true)
      window.removeEventListener('keydown', onKeydown)
    }
  })
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
  }
  function setMessageRole(id, role) {
    // Role change should behave like content change: do not alter branching.
    const roles = new Set(['user', 'assistant', 'system'])
    if (!roles.has(role)) return
    messages = messages.map(m => (m.id === id ? { ...m, role } : m))
    // Keep view anchored
    queueMicrotask(() => { scrollToBottom() })
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
  function moveUp(id) {
    const i = messages.findIndex(m => m.id === id)
    if (i > 0) {
      const arr = messages.slice()
      ;[arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]
      // Re-sync branching for both swapped messages (earlier index first)
      arr[i - 1] = alignMessageToChainAt(arr, i - 1)
      arr[i] = alignMessageToChainAt(arr, i)
      messages = arr
    }
  }
  function moveDown(id) {
    const i = messages.findIndex(m => m.id === id)
    if (i >= 0 && i < messages.length - 1) {
      const arr = messages.slice()
      ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
      // Re-sync branching for both swapped messages (earlier index first)
      arr[i] = alignMessageToChainAt(arr, i)
      arr[i + 1] = alignMessageToChainAt(arr, i + 1)
      messages = arr
    }
  }
  function editMessage(id) {
    const msg = messages.find(m => m.id === id)
    if (!msg || msg.typing) return
    editingId = id
    editingText = msg.content || ''
    // Focus bubble and set its text inline
    queueMicrotask(() => {
      if (editingEl) {
        editingEl.textContent = editingText
        editingEl.focus()
        placeCaretAtEnd(editingEl)
      }
    })
  }
  function commitEdit() {
    if (editingId == null) return
    const val = String(editingEl?.innerText ?? editingText)
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
  }
  // Replace the current message content in-place (no branching)
  function applyEditReplace() { commitEdit() }

  // Create a branch for the edited message without generating a new reply
  function applyEditBranch() {
    if (editingId == null) return
    const i = messages.findIndex(m => m.id === editingId)
    if (i < 0) return
    const val = String(editingEl?.innerText ?? editingText)
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
    editingId = null
    editingText = ''
    queueMicrotask(() => scrollToBottom())
  }

  // Branch and generate a new assistant reply starting after the edited message
  async function applyEditSend() {
    if (editingId == null) return
    const i0 = messages.findIndex(m => m.id === editingId)
    if (i0 < 0) return
    const val = String(editingEl?.innerText ?? editingText)
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

      try {
        let reply
        const { apiKey } = settings
        const history = buildVisibleUpTo(insertIndex + 1)
          .filter(m => !m.typing)
          .map(({ role, content }) => ({ role, content }))
        if (apiKey) {
          reply = await respond({ messages: history, model: chatModel })
        } else {
          const lastUser = [...buildVisibleUpTo(insertIndex + 1)].reverse().find(m => m.role === 'user')
          reply = generatePlaceholderReply(lastUser?.content || val) +
            '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
        }
        messages = messages.map(m => (m.id === typingMsg.id
          ? { ...m, content: reply, typing: false, variants: [reply], variantIndex: 0 }
          : m))
      } catch (err) {
        const msg = err?.message || 'Something went wrong.'
        const errText = `Error: ${msg}`
        messages = messages.map(m => (m.id === typingMsg.id
          ? { ...m, content: errText, typing: false, variants: [errText], variantIndex: 0 }
          : m))
      } finally {
        queueMicrotask(() => scrollToBottom())
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
    editingId = null
    editingText = ''

    // Insert typing placeholder after the edited message (in new chain)
    const typingMsg = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true }
    arr = messages.slice()
    const insertIndex = i0
    arr.splice(i0 + 1, 0, typingMsg)
    messages = arr

    try {
      let reply
      const { apiKey } = settings
      const history = buildVisibleUpTo(insertIndex + 1)
        .filter(m => !m.typing)
        .map(({ role, content }) => ({ role, content }))
      if (apiKey) {
        reply = await respond({ messages: history, model: chatModel })
      } else {
        const lastUser = [...buildVisibleUpTo(insertIndex + 1)].reverse().find(m => m.role === 'user')
        reply = generatePlaceholderReply(lastUser?.content || val) +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      const parentChain = chainFromVisibleUpTo(insertIndex + 1)
      messages = messages.map(m => (m.id === typingMsg.id
        ? { ...m, content: reply, typing: false, variants: [reply], variantIndex: 0, branchPathBefore: parentChain }
        : m))
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      const errText = `Error: ${msg}`
      const parentChain = chainFromVisibleUpTo(insertIndex + 1)
      messages = messages.map(m => (m.id === typingMsg.id
        ? { ...m, content: errText, typing: false, variants: [errText], variantIndex: 0, branchPathBefore: parentChain }
        : m))
    } finally {
      queueMicrotask(() => scrollToBottom())
    }
  }
  function cancelEdit() {
    editingId = null
    editingText = ''
  }
  // small sanitizer to avoid HTML injection in placeholder echo
  function sanitize(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
      .replaceAll('\n', '<br/>')
  }

  

  // keep view anchored to the latest messages
  $effect(() => {
    // Run when messages or layout change
    scrollToBottom()
  })

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
      const { apiKey } = settings
      if (apiKey) {
        // Build history up to (but not including) this assistant message
        const history = buildVisibleUpTo(idx)
          .filter(m => !m.typing)
          .map(({ role, content }) => ({ role, content }))
        reply = await respond({ messages: history, model: chatModel })
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
    } finally {
      // keep view anchored
      queueMicrotask(() => scrollToBottom())
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

    try {
      let reply
      const { apiKey } = settings
      const history = buildVisibleUpTo(insertIndex + 1)
        .filter(m => !m.typing)
        .map(({ role, content }) => ({ role, content }))
      if (apiKey) {
        reply = await respond({ messages: history, model: chatModel })
      } else {
        const lastUser = [...buildVisibleUpTo(insertIndex + 1)].reverse().find(m => m.role === 'user')
        reply = generatePlaceholderReply(lastUser?.content || cur.content) +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      messages = messages.map(m => (m.id === typingMsg.id
        ? { ...m, content: reply, typing: false, variants: [reply], variantIndex: 0 }
        : m))
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      const errText = `Error: ${msg}`
      messages = messages.map(m => (m.id === typingMsg.id
        ? { ...m, content: errText, typing: false, variants: [errText], variantIndex: 0 }
        : m))
    } finally {
      queueMicrotask(() => scrollToBottom())
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
  }
</script>

<section class="chat-shell">
  <TopBar onOpenSettings={() => (showSettings = true)} onNewChat={newChat} />

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
    chatModel={chatModel}
    modelIds={modelIds}
    onToggleChatSettings={toggleChatSettings}
    onCloseChatSettings={() => (chatSettingsOpen = false)}
    onChangeModel={(val) => (chatModel = val)}
    onInput={(val) => (input = val)}
    onAdd={(role) => addToChat(role)}
    onSend={(role) => sendWithRole(role)}
  />

  <SettingsModal open={showSettings} onClose={() => { showSettings = false; settings = loadSettings() }} />
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
    grid-template-rows: auto 1fr auto;
    background: var(--bg);
    color: var(--text);
    padding-inline: var(--page-gutter);
    padding-top: 0;
    padding-bottom: 0;
    overflow-x: hidden;
  }

  .topbar {
    position: sticky;
    top: 0;
    left: 0;
    right: 0;
    z-index: 5;
    background: transparent;
  }
  .topbar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 0;
    max-width: var(--page-max);
    margin-inline: auto;
    /* no background/border here — keep only title box + button */
    padding-inline: 0; /* chat-shell already provides horizontal gutter */
  }
  .titlebox {
    font-weight: 600;
    letter-spacing: 0.2px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    flex: 1;
    min-height: 44px;
    display: flex;
    align-items: center;
  }
  .icon-btn {
    flex: none;
    min-width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    line-height: 1;
  }
  .icon-btn :global(.icon) { font-size: 22px; }

  .messages {
    overflow: auto;
    /* vertical breathing room; horizontal handled by shell */
    padding: 16px 0 8px;
    display: grid;
    align-content: start;
    gap: 8px;
  }
  .row {
    display: flex;
    max-width: var(--page-max);
    margin-inline: auto;
    width: 100%;
    padding-inline: 0;
  }
  .row.user { justify-content: flex-end; }
  .row.assistant { justify-content: flex-start; }
  .row.system { justify-content: center; }

  /* Ensure a consistent line length for message content */
  /* Use grid so bubble and actions share the same content-width column */
  .stack { display: grid; grid-auto-flow: row; grid-auto-rows: max-content; grid-template-columns: minmax(0, 1fr); gap: 2px; width: min(720px, 92%); }
  /* Keep width consistent while editing (inline) */
  /* .stack.editing { width: 100%; max-width: var(--page-max); } */
  .stack.assistant { justify-content: start; }
  .stack.user { justify-content: end; }
  /* System rows can expand up to full chat width but not forced */
  .stack.system { justify-content: center; width: 100%; max-width: var(--page-max); }

  .meta { font-size: .8rem; color: var(--muted); padding: 0 2px; margin-bottom: 6px; }
  .meta.user { justify-self: end; }
  .meta.assistant { justify-self: start; }
  .meta.system { justify-self: center; text-align: center; }

  /* Role badge as a textish ghost button */
  /* Now reusing .send-group + .send-menu for the dropdown behavior */
  .role-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    line-height: 1.2;
    font: inherit;
    cursor: default;
    transition: color .12s ease, border-color .12s ease, background-color .12s ease;
  }
  .role-badge:hover, .role-badge:focus-visible {
    color: var(--text);
    border-color: color-mix(in srgb, var(--border), #ffffff 16%);
    background: transparent;
  }
  /* Message role menu: open DOWN and sit above all UI */
  .meta .send-group { z-index: 1000; }
  .meta .send-group:hover,
  .meta .send-group:focus-within { z-index: 1000; }
  .meta .send-group .send-menu {
    top: calc(100% + 8px);
    bottom: auto;
    z-index: 1000; /* above composer/topbar */
    transform: translateY(-6px); /* animate up into place */
  }
  /* Hover bridge below the trigger (since menu opens downward)
     Make it side-aware so it doesn't create a hover zone on the wrong side. */
  .meta .send-group::before {
    top: 100%;
    bottom: auto;
    width: 180px; /* roughly matches menu width without overshooting */
    height: 12px;
    right: 0; /* default for right-anchored (user) messages */
    left: auto;
  }
  /* Assistant messages anchor menu to the left; bridge should align left too */
  .stack.assistant .meta .send-group::before { left: 0; right: auto; }
  /* Centered (system) rows: center the bridge to match centered menu */
  .stack.system .meta .send-group::before { left: 50%; right: auto; transform: translateX(-50%); }
  /* Side-aware anchoring for the reused .send-menu in message meta */
  .stack.assistant .meta .send-group .send-menu { left: 0; right: auto; }
  .stack.user .meta .send-group .send-menu { right: 0; left: auto; }
  .stack.system .meta .send-group .send-menu { left: 50%; right: auto; transform: translate(-50%, -6px); }
  .stack.system .meta .send-group:hover .send-menu,
  .stack.system .meta .send-group:focus-within .send-menu { transform: translate(-50%, 0); }

  .bubble {
    /* Hug content up to the stack's max width */
    display: block;
    max-width: 100%;
    padding: 10px var(--bubble-pad-x);
    border-radius: 14px;
    border: none;
    /* For rendered Markdown, rely on block/inline flow */
    white-space: normal;
    overflow-wrap: anywhere; /* handles long unbroken strings */
    word-break: break-word;  /* fallback for older engines */
    line-height: 1.4;
    font-size: 0.98rem;
    box-shadow: 0 1px 0 rgba(0,0,0,0.04);
  }
  /* When editing, preserve user newlines */
  .bubble.editing { white-space: pre-wrap; }
  /* Basic Markdown styles inside bubbles (use :global for {@html} content) */
  .bubble :global(h1), .bubble :global(h2), .bubble :global(h3), .bubble :global(h4), .bubble :global(h5), .bubble :global(h6) {
    margin: 0.2em 0 0.4em;
    line-height: 1.25;
  }
  .bubble :global(h1) { font-size: 1.35rem; }
  .bubble :global(h2) { font-size: 1.25rem; }
  .bubble :global(h3) { font-size: 1.15rem; }
  .bubble :global(p) { margin: 0.2em 0; }
  /* Extra spacing only between adjacent paragraphs */
  .bubble :global(p + p) { margin-top: 0.8em; }
  /* Normalize list spacing and indent for Markdown lists */
  /* Indent lists inside the bubble (visible insets) */
  .bubble :global(ul), .bubble :global(ol) { margin: 0; padding-left: 2em; list-style-position: inside; }
  .bubble :global(ul) { list-style: disc; }
  .bubble :global(ol) { list-style: decimal; }
  .bubble :global(li) { margin: 0.2em 0; }
  /* Remove extra gap at the start/end of lists */
  .bubble :global(ul > li:first-child),
  .bubble :global(ol > li:first-child) { margin-top: 0; }
  .bubble :global(ul > li:last-child),
  .bubble :global(ol > li:last-child) { margin-bottom: 0; }
  .bubble :global(a) { color: var(--accent); text-decoration: underline; }
  .bubble :global(code) { background: color-mix(in srgb, var(--panel), #ffffff 8%); padding: 0 3px; border-radius: 4px; }
  .bubble :global(pre) { background: color-mix(in srgb, var(--panel), #ffffff 6%); padding: 10px; border-radius: 10px; overflow: auto; }
  .bubble :global(pre code) { background: transparent; padding: 0; }
  /* Trim top/bottom margins inside the bubble to avoid extra space */
  .bubble :global(p:first-child),
  .bubble :global(ul:first-child),
  .bubble :global(ol:first-child),
  .bubble :global(pre:first-child),
  .bubble :global(h1:first-child),
  .bubble :global(h2:first-child),
  .bubble :global(h3:first-child),
  .bubble :global(h4:first-child),
  .bubble :global(h5:first-child),
  .bubble :global(h6:first-child) { margin-top: 0; }
  .bubble :global(p:last-child),
  .bubble :global(ul:last-child),
  .bubble :global(ol:last-child),
  .bubble :global(pre:last-child),
  .bubble :global(h1:last-child),
  .bubble :global(h2:last-child),
  .bubble :global(h3:last-child),
  .bubble :global(h4:last-child),
  .bubble :global(h5:last-child),
  .bubble :global(h6:last-child) { margin-bottom: 0; }
  /* Keep bubble look while editing (inline editing) */
  /* .bubble.editing { display: block; max-width: none; width: 100%; padding: 0; background: transparent; box-shadow: none; } */
  .bubble.assistant {
    background: transparent;
  }
  .bubble.user { background: var(--user); color: var(--text); }
  /* Align bubbles within the grid column */
  .bubble.assistant { justify-self: start; }
  .bubble.user { justify-self: end; }
  .bubble.system { justify-self: center; }
  .bubble.system { background: transparent; color: var(--muted); border: 1px dashed var(--border); }
  /* Keep system bubble width while editing */
  /* .bubble.system.editing { display: block; width: 100%; max-width: none; padding: 0; background: transparent; box-shadow: none; } */

  /* Inline bubble editor — looks like text inside the bubble */
  .bubble-editor {
    width: 100%;
    box-sizing: border-box;
    display: block;
    resize: none;
    min-height: 28px;
    height: 28px; /* autoGrow adjusts */
    max-height: 240px;
    overflow: hidden;
    padding: 0; /* use the bubble's own padding */
    border: none;
    border-radius: 0;
    background: transparent;
    color: inherit;
    line-height: inherit;
    font: inherit;
  }

  .actions { display: flex; gap: 6px; margin-top: 6px; }
  /* Align actions with bubble edges by sharing the same grid column */
  .actions.user { justify-self: end; }
  .actions.assistant { justify-self: start; }
  .actions.system { justify-self: center; }
  .action-btn {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    color: var(--muted);
    background: transparent;
    border: none;
    border-radius: 8px;
    line-height: 1;
    padding: 0;
    cursor: default;
    transition: color .15s ease;
  }
  .action-btn:hover { color: #ffffff; }
  .action-btn:focus-visible { color: #ffffff; }
  .action-btn:disabled { opacity: .5; cursor: not-allowed; }
  .variant-counter { align-self: center; font-size: .8rem; color: var(--muted); min-width: 36px; text-align: center; }

  .composer {
    position: sticky;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 5;
    background: transparent;
  }
  .composer-inner {
    max-width: var(--page-max);
    margin-inline: auto;
    padding: 12px 0;
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 14px; /* a bit more spacing between controls */
  }
  .composer-input {
    resize: none;
    width: 100%;
    min-height: 44px;
    height: 44px; /* start at 44px */
    max-height: 240px;
    overflow: hidden; /* avoid showing scrollbar until needed */
    padding: 12px; /* simple padding; button is now separate */
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    line-height: 1.35;
    font: inherit;
    box-sizing: border-box;
  }
  .float-btn {
    position: static;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    border: none;
    background: var(--accent);
    color: #fff;
    line-height: 1;
    transition: background-color .15s ease, color .15s ease, border-color .15s ease, opacity .15s ease;
  }
  .float-btn :global(.icon) { font-size: 22px; }
  .float-btn:disabled {
    background: #9ca3af;
    border-color: transparent;
    color: #ffffff;
    cursor: not-allowed;
  }

  /* Send-as hover menu */
  .send-group { position: relative; display: grid; place-items: center; z-index: 0; }
  /* Ensure the active group's hover bridge/menu sits above neighbors */
  .send-group:hover,
  .send-group:focus-within { z-index: 20; }
  /* Hover bridge to prevent flicker when moving from button to menu */
  .send-group::before {
    content: '';
    position: absolute;
    right: 0;
    bottom: 100%;
    /* Wide enough to cover the menu width so hover doesn't drop */
    width: 220px;
    /* Taller than the vertical gap so there is no dead zone */
    height: 12px;
  }
  .send-menu {
    position: absolute;
    /* 10px gap above the button */
    bottom: calc(100% + 10px);
    right: 0;
    display: grid;
    gap: 6px;
    padding: 8px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--float-shadow);
    opacity: 0;
    transform: translateY(6px);
    transition: opacity .12s ease, transform .12s ease;
    pointer-events: none;
    min-width: 160px;
    z-index: 10;
  }
  .send-group:hover .send-menu,
  .send-group:focus-within .send-menu { opacity: 1; transform: translateY(0); pointer-events: auto; }
  .menu-item {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 8px 10px;
    font: inherit;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .menu-item:disabled { opacity: .6; cursor: not-allowed; }

  /* Per-chat settings popover */
  .chat-settings-menu { min-width: 260px; gap: 12px; padding: 12px; }
  .chat-settings-menu .menu-section { display: grid; gap: 6px; }
  .chat-settings-menu .menu-label { font-size: .9rem; color: var(--muted); }
  .chat-settings-menu input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    box-sizing: border-box;
  }

  /* Per-chat settings: open UP but slightly to the RIGHT */
  .chat-settings-group .chat-settings-menu {
    top: auto;
    bottom: calc(100% + 10px);
    left: 8px;   /* nudge to the right of the button */
    right: auto;
    transform: translateY(6px);
  }
  /* Open on click (not hover): override default hover behavior */
  .chat-settings-group:not(.open) .chat-settings-menu { opacity: 0 !important; pointer-events: none !important; transform: translateY(6px) !important; }
  .chat-settings-group.open { z-index: 20; }
  .chat-settings-group.open .chat-settings-menu { opacity: 1 !important; pointer-events: auto !important; transform: translateY(0) !important; }
  /* Hover bridge above the button to the menu (aligned for left-anchored menu) */
  .chat-settings-group::before {
    right: auto;
    left: 0;          /* bridge from left edge so it covers the menu area */
    bottom: 100%;
    top: auto;
    width: 220px;     /* wide enough to span the menu */
    height: 12px;     /* gap height */
  }

  /* Typing dots */
  .dots {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .dots i {
    width: 6px; height: 6px;
    display: inline-block;
    background: currentColor;
    opacity: 0.5;
    border-radius: 999px;
    animation: pop 1.2s infinite ease-in-out;
  }
  .dots i:nth-child(2) { animation-delay: .15s; }
  .dots i:nth-child(3) { animation-delay: .30s; }
  @keyframes pop {
    0%, 80%, 100% { transform: translateY(0); opacity: .45 }
    40% { transform: translateY(-3px); opacity: .9 }
  }
</style>
