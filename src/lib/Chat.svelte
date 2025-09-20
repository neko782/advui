<script>
  // Svelte 5 runes API
  import Icon from './Icon.svelte'
  import SettingsModal from './SettingsModal.svelte'
  import { loadSettings } from './settingsStore.js'
  import { ensureModels, loadModelsCache } from './modelsStore.js'
  import { respond } from './openaiClient.js'

  let messages = $state([])
  let input = $state('')
  let sending = $state(false)
  let nextId = $state(1)
  let showSettings = $state(false)
  let settings = $state(loadSettings())
  // Per-chat setting: model (default from global)
  let chatModel = $state(settings.model || 'gpt-4o-mini')
  // Per-chat settings popover open state
  let chatSettingsOpen = $state(false)
  let chatSettingsEl
  // Cached models (for datalist)
  let modelIds = $state(loadModelsCache().ids || [])
  let editingId = $state(null)
  let editingText = $state('')
  let editingEl
  // Branching helpers: messages after an assistant "anchor" belong to a branch path
  function buildSelectedChainUpTo(indexExclusive) {
    let chain = ''
    const upto = Math.max(0, Math.min(indexExclusive ?? messages.length, messages.length))
    for (let i = 0; i < upto; i++) {
      const m = messages[i]
      if (m && m.role === 'assistant' && Array.isArray(m.variants)) {
        const vi = typeof m.variantIndex === 'number' ? m.variantIndex : 0
        chain = chain ? `${chain}|${m.id}:${vi}` : `${m.id}:${vi}`
      }
    }
    return chain
  }
  function buildCurrentSelectedChain() {
    return buildSelectedChainUpTo(messages.length)
  }
  function buildVisible() {
    const out = []
    let chain = ''
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (m?.role === 'assistant' && Array.isArray(m.variants)) {
        // Show this anchor only if it belongs to the current chain at this point
        const parent = m.branchPathBefore ?? ''
        if (parent === chain) {
          out.push({ m, i })
          const vi = typeof m.variantIndex === 'number' ? m.variantIndex : 0
          chain = chain ? `${chain}|${m.id}:${vi}` : `${m.id}:${vi}`
        }
        continue
      }
      if (m?.branchPath != null) {
        if (m.branchPath === chain) out.push({ m, i })
      } else {
        out.push({ m, i })
      }
    }
    return out
  }
  function buildVisibleUpTo(indexExclusive) {
    const upto = Math.max(0, Math.min(indexExclusive ?? 0, messages.length))
    const out = []
    let chain = ''
    for (let i = 0; i < upto; i++) {
      const m = messages[i]
      if (m?.role === 'assistant' && Array.isArray(m.variants)) {
        const parent = m.branchPathBefore ?? ''
        if (parent === chain) {
          out.push(m)
          const vi = typeof m.variantIndex === 'number' ? m.variantIndex : 0
          chain = chain ? `${chain}|${m.id}:${vi}` : `${m.id}:${vi}`
        }
        continue
      }
      if (m?.branchPath != null) {
        if (m.branchPath === chain) out.push(m)
      } else {
        out.push(m)
      }
    }
    return out
  }
  function placeCaretAtEnd(el) {
    try {
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    } catch {}
  }
  function onEditableInput(e) {
    if (editingId == null) return
    // Keep state in sync without re-rendering content
    try { editingText = e.currentTarget.innerText } catch {}
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

  function autoGrow(el) {
    if (!el) return
    const max = 240
    const min = 44
    // Reset height to measure accurate scrollHeight
    el.style.height = 'auto'
    const content = el.scrollHeight
    const next = Math.min(content, max)
    el.style.height = Math.max(next, min) + 'px'
    // Hide scrollbar while content fits under max; show once capped
    el.style.overflowY = content > max ? 'auto' : 'hidden'
  }

  function formatRole(role) {
    if (role === 'assistant') return 'Assistant'
    if (role === 'system') return 'System'
    return 'User'
  }

  // Send a message (with chosen role) and request an assistant reply via API
  async function sendWithRole(role = 'user') {
    const text = input.trim()
    if (!text || sending) return

    sending = true
    const firstMsg = { id: nextId++, role, content: text, time: Date.now(), branchPath: buildCurrentSelectedChain() }
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
      const parentChain = buildCurrentSelectedChain()
      messages = messages.map(m => (m.id === typingMsg.id ? { ...m, content: reply, typing: false, variants: [reply], variantIndex: 0, branchPathBefore: parentChain } : m))
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      const errText = `Error: ${msg}`
      const parentChain = buildCurrentSelectedChain()
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
    const direct = role === 'assistant'
      ? { id: nextId++, role, content: text, time: Date.now(), variants: [text], variantIndex: 0, branchPathBefore: buildCurrentSelectedChain() }
      : { id: nextId++, role, content: text, time: Date.now(), branchPath: buildCurrentSelectedChain() }
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

  let listEl
  let inputEl
  function scrollToBottom() {
    if (!listEl) return
    listEl.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' })
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
  async function copyMessage(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        return
      }
    } catch {}
    // Fallback
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {}
  }
  function deleteMessage(id) {
    messages = messages.filter(m => m.id !== id)
  }
  function setMessageRole(id, role) {
    const roles = new Set(['user', 'assistant', 'system'])
    if (!roles.has(role)) return
    const i = messages.findIndex(m => m.id === id)
    if (i < 0) return
    const parentChain = buildSelectedChainUpTo(i)
    messages = messages.map(m => {
      if (m.id !== id) return m
      if (role === 'assistant') {
        // Ensure variants structure exists for assistant messages
        const base = Array.isArray(m.variants) && typeof m.variantIndex === 'number'
          ? m
          : { ...m, variants: [m.content], variantIndex: 0 }
        const { branchPath, ...rest } = base
        return { ...rest, role, branchPathBefore: parentChain }
      }
      // Drop variants when changing away from assistant and tag with parent branch
      const { variants, variantIndex, branchPathBefore, ...rest } = m
      return { ...rest, role, branchPath: parentChain }
    })
    // Nudge layout and keep view anchored
    queueMicrotask(() => {
      // Read to force reflow then scroll
      try { void listEl?.offsetHeight } catch {}
      scrollToBottom()
    })
  }
  function moveUp(id) {
    const i = messages.findIndex(m => m.id === id)
    if (i > 0) {
      const arr = messages.slice()
      ;[arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]
      messages = arr
    }
  }
  function moveDown(id) {
    const i = messages.findIndex(m => m.id === id)
    if (i >= 0 && i < messages.length - 1) {
      const arr = messages.slice()
      ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
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

  import MarkdownIt from 'markdown-it'
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false })
  // Open links in a new tab and add rel; basic scheme guard left to the browser
  const defaultRenderLink = md.renderer.rules.link_open || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options)
  }
  md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
    const a = tokens[idx]
    // add target and rel
    const targetIndex = a.attrIndex('target')
    if (targetIndex < 0) a.attrPush(['target', '_blank']); else a.attrs[targetIndex][1] = '_blank'
    const relIndex = a.attrIndex('rel')
    if (relIndex < 0) a.attrPush(['rel', 'noopener noreferrer']); else a.attrs[relIndex][1] = 'noopener noreferrer'
    return defaultRenderLink(tokens, idx, options, env, self)
  }
  function renderMarkdown(src) { return md.render(String(src || '')) }

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

    // Mark as typing on the target message
    messages = messages.map(m => (m.id === id ? { ...m, typing: true } : m))
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
        arr.push(reply)
        const vi = arr.length - 1
        return { ...m, typing: false, content: reply, variants: arr, variantIndex: vi }
      })
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      const errText = `Error: ${msg}`
      messages = messages.map(m => {
        if (m.id !== id) return m
        const arr = Array.isArray(m.variants) ? m.variants.slice() : [m.content]
        arr.push(errText)
        const vi = arr.length - 1
        return { ...m, typing: false, content: errText, variants: arr, variantIndex: vi }
      })
    } finally {
      // keep view anchored
      queueMicrotask(() => scrollToBottom())
    }
  }

  function changeVariant(id, delta) {
    const i = messages.findIndex(m => m.id === id)
    if (i < 0) return
    const m = messages[i]
    if (m.role !== 'assistant' || !Array.isArray(m.variants) || !m.variants.length) return
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
  <header class="topbar">
    <div class="topbar-inner">
      <div class="titlebox">AI Chat</div>
      <button
        class="icon-btn"
        title="Settings"
        onclick={() => (showSettings = true)}
        aria-label="Settings"
      >
        <Icon name="settings" size={22} />
      </button>
      <button
        class="icon-btn"
        title="New chat"
        onclick={newChat}
        aria-label="New chat"
      >
        <Icon name="add" size={22} />
      </button>
    </div>
  </header>

  <div class="messages" bind:this={listEl}>
    {#each buildVisible() as vm, vi (vm.m.id)}
      <div class={`row ${vm.m.role}`}>
        {#key vm.m.role}
        <div class={`stack ${vm.m.role} ${vm.m.id === editingId ? 'editing' : ''}`}>
          <div class={`meta ${vm.m.role}`}>
            <div class="send-group" aria-haspopup="menu" title="Change role">
              <button class="role-badge" aria-label={`Role: ${formatRole(vm.m.role)}`}>
                {formatRole(vm.m.role)}
              </button>
              <div class="send-menu" role="menu" aria-label="Change role">
                <button role="menuitem" class="menu-item" onclick={() => setMessageRole(vm.m.id, 'user')} aria-label="Set role user">
                  <Icon name="person" size={18} />
                  User
                </button>
                <button role="menuitem" class="menu-item" onclick={() => setMessageRole(vm.m.id, 'assistant')} aria-label="Set role assistant">
                  <Icon name="smart_toy" size={18} />
                  Assistant
                </button>
                <button role="menuitem" class="menu-item" onclick={() => setMessageRole(vm.m.id, 'system')} aria-label="Set role system">
                  <Icon name="tune" size={18} />
                  System
                </button>
              </div>
            </div>
          </div>
          {#if vm.m.id === editingId}
            <div
              class={`bubble ${vm.m.role} editing`}
              contenteditable="true"
              role="textbox"
              tabindex="0"
              aria-multiline="true"
              oninput={onEditableInput}
              onkeydown={onEditableKeydown}
              onpaste={onEditablePaste}
              bind:this={editingEl}
            ></div>
          {:else}
            <div
              class={`bubble ${vm.m.role}`}
              data-typing={vm.m.typing ? true : undefined}
            >
              {#if vm.m.typing}
                <span class="dots"><i></i><i></i><i></i></span>
              {:else}
                {@html renderMarkdown(vm.m.content)}
              {/if}
            </div>
          {/if}
          <div class={`actions ${vm.m.role}`}>
            {#if vm.m.id === editingId}
              <button class="action-btn" onclick={commitEdit} aria-label="Save edit" title="Save">
                <Icon name="check" size={20} />
              </button>
              <button class="action-btn" onclick={cancelEdit} aria-label="Cancel edit" title="Cancel">
                <Icon name="close" size={20} />
              </button>
            {:else}
              {#if vm.m.role === 'assistant'}
                <button class="action-btn" onclick={() => refreshAssistant(vm.m.id)} aria-label="Regenerate response" title="Regenerate" disabled={vm.m.typing}>
                  <Icon name="autorenew" size={20} />
                </button>
                {#if Array.isArray(vm.m.variants) && vm.m.variants.length > 1}
                  <button class="action-btn" onclick={() => changeVariant(vm.m.id, -1)} aria-label="Previous variant" title="Previous" disabled={vm.m.typing || (vm.m.variantIndex || 0) <= 0}>
                    <Icon name="chevron_left" size={20} />
                  </button>
                  <span class="variant-counter" aria-live="polite">{(vm.m.variantIndex || 0) + 1}/{vm.m.variants.length}</span>
                  <button class="action-btn" onclick={() => changeVariant(vm.m.id, +1)} aria-label="Next variant" title="Next" disabled={vm.m.typing || (vm.m.variantIndex || 0) >= (vm.m.variants.length - 1)}>
                    <Icon name="chevron_right" size={20} />
                  </button>
                {/if}
              {:else if vm.m.role === 'user' && messages[vm.i + 1] && messages[vm.i + 1].role === 'assistant'}
                <!-- Allow refresh from the preceding user message when it has a following assistant reply -->
                <button class="action-btn" onclick={() => refreshAssistant(messages[vm.i + 1].id)} aria-label="Regenerate following response" title="Regenerate following response" disabled={messages[vm.i + 1].typing}>
                  <Icon name="autorenew" size={20} />
                </button>
              {/if}
              <button class="action-btn" onclick={() => copyMessage(vm.m.content)} aria-label="Copy message" title="Copy" disabled={vm.m.typing}>
                <Icon name="content_copy" size={20} />
              </button>
              <button class="action-btn" onclick={() => deleteMessage(vm.m.id)} aria-label="Delete message" title="Delete" disabled={vm.m.typing}>
                <Icon name="delete" size={20} />
              </button>
              <button class="action-btn" onclick={() => editMessage(vm.m.id)} aria-label="Edit message" title="Edit" disabled={vm.m.typing}>
                <Icon name="edit" size={20} />
              </button>
              <button class="action-btn" onclick={() => moveDown(vm.m.id)} aria-label="Move down" title="Down" disabled={vm.m.typing || vm.i === messages.length - 1}>
                <Icon name="arrow_downward" size={20} />
              </button>
              <button class="action-btn" onclick={() => moveUp(vm.m.id)} aria-label="Move up" title="Up" disabled={vm.m.typing || vm.i === 0}>
                <Icon name="arrow_upward" size={20} />
              </button>
            {/if}
          </div>
        </div>
        {/key}
      </div>
    {/each}
  </div>

  <footer class="composer">
    <div class="composer-inner">
      <!-- Per-chat settings (before input) -->
      <div class={`send-group chat-settings-group ${chatSettingsOpen ? 'open' : ''}`} aria-haspopup="menu" title="Chat settings" bind:this={chatSettingsEl}>
        <button class="icon-btn" aria-label="Chat settings" onclick={toggleChatSettings}>
          <!-- Different icon from top settings -->
          <Icon name="tune" size={22} />
        </button>
        <div class="send-menu chat-settings-menu" role="menu" aria-label="Chat settings">
          <div class="menu-section">
            <div class="menu-label">Model</div>
            <input type="text" placeholder="gpt-4o-mini" bind:value={chatModel} aria-label="Model" list="model-suggestions" />
            {#if modelIds?.length}
              <datalist id="model-suggestions">
                {#each modelIds as mid}
                  <option value={mid}></option>
                {/each}
              </datalist>
            {/if}
          </div>
        </div>
      </div>
      <textarea
        class="composer-input"
        placeholder="Type a message…"
        bind:value={input}
        oninput={(e) => autoGrow(e.currentTarget)}
        onkeydown={onKey}
        rows="1"
        bind:this={inputEl}
      ></textarea>
      <!-- Add-to-chat group (now first, swapped) -->
      <div class="send-group" aria-haspopup="menu">
        <button class="float-btn" onclick={() => addToChat('user')} disabled={!input.trim()} aria-label="Add to chat">
          <Icon name="add_comment" size={22} />
        </button>
        <div class="send-menu" role="menu" aria-label="Add to chat as">
          <button role="menuitem" class="menu-item" onclick={() => addToChat('user')} disabled={!input.trim()} aria-label="Add as user">
            <Icon name="person" size={18} />
            User
          </button>
          <button role="menuitem" class="menu-item" onclick={() => addToChat('assistant')} disabled={!input.trim()} aria-label="Add as assistant">
            <Icon name="smart_toy" size={18} />
            Assistant
          </button>
          <button role="menuitem" class="menu-item" onclick={() => addToChat('system')} disabled={!input.trim()} aria-label="Add as system">
            <Icon name="tune" size={18} />
            System
          </button>
        </div>
      </div>

      <!-- Send group (with full role menu) -->
      <div class="send-group" aria-haspopup="menu">
        <button class="float-btn" onclick={() => sendWithRole('user')} disabled={!input.trim() || sending} aria-label="Send">
          <Icon name="send" size={22} />
        </button>
        <div class="send-menu" role="menu" aria-label="Send as">
          <button role="menuitem" class="menu-item" onclick={() => sendWithRole('user')} disabled={!input.trim() || sending} aria-label="Send as user">
            <Icon name="send" size={18} />
            User
          </button>
          <button role="menuitem" class="menu-item" onclick={() => sendWithRole('assistant')} disabled={!input.trim() || sending} aria-label="Send as assistant">
            <Icon name="send" size={18} />
            Assistant
          </button>
          <button role="menuitem" class="menu-item" onclick={() => sendWithRole('system')} disabled={!input.trim() || sending} aria-label="Send as system">
            <Icon name="send" size={18} />
            System
          </button>
        </div>
      </div>
    </div>
  </footer>

  <SettingsModal open={showSettings} onClose={() => { showSettings = false; settings = loadSettings() }} />
</section>

<style>
  /* Grayscale UI with accent reserved for buttons */
  :global(:root) {
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
    :global(:root) {
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
  /* Basic Markdown styles inside bubbles */
  .bubble h1, .bubble h2, .bubble h3, .bubble h4, .bubble h5, .bubble h6 {
    margin: 0.2em 0 0.4em;
    line-height: 1.25;
  }
  .bubble h1 { font-size: 1.35rem; }
  .bubble h2 { font-size: 1.25rem; }
  .bubble h3 { font-size: 1.15rem; }
  .bubble p { margin: 0.2em 0; }
  .bubble ul { margin: 0.2em 0 0.2em 1.2em; padding: 0; }
  .bubble li { margin: 0.2em 0; }
  .bubble a { color: var(--accent); text-decoration: underline; }
  .bubble code { background: color-mix(in srgb, var(--panel), #ffffff 8%); padding: 0 3px; border-radius: 4px; }
  .bubble pre { background: color-mix(in srgb, var(--panel), #ffffff 6%); padding: 10px; border-radius: 10px; overflow: auto; }
  .bubble pre code { background: transparent; padding: 0; }
  /* Trim top/bottom margins inside the bubble to avoid extra space */
  .bubble > :first-child { margin-top: 0; }
  .bubble > :last-child { margin-bottom: 0; }
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
