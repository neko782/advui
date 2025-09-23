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

  let nodes = $state([])
  let input = $state('')
  let sending = $state(false)
  // Lock all chat actions while a response is generating (sending or any typing)
  let locked = $state(false)
  let nextId = $state(1)
  let nextNodeId = $state(1)
  const initialSettings = loadSettings()
  let settings = $state(initialSettings)
  let debug = $state(!!initialSettings?.debug)
  const REASONING_VALUES = new Set(['none', 'minimal', 'low', 'medium', 'high'])
  const TEXT_VERBOSITY_VALUES = new Set(['low', 'medium', 'high'])
  function toIntOrNull(val) {
    if (val === '' || val == null) return null
    const num = Number(val)
    if (!Number.isFinite(num)) return null
    const rounded = Math.max(1, Math.floor(num))
    return Number.isFinite(rounded) ? rounded : null
  }
  function toClampedNumber(val, min, max) {
    if (val === '' || val == null) return null
    const num = Number(val)
    if (!Number.isFinite(num)) return null
    return Math.min(max, Math.max(min, num))
  }
  function normalizeReasoning(val) {
    return REASONING_VALUES.has(val) ? val : 'none'
  }
  function normalizeVerbosity(val) {
    return TEXT_VERBOSITY_VALUES.has(val) ? val : 'medium'
  }
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key)
  function normalizePreset(p) {
    if (!p || typeof p !== 'object') {
      return {
        id: null,
        model: 'gpt-4o-mini',
        streaming: true,
        maxOutputTokens: null,
        topP: null,
        temperature: null,
        reasoningEffort: 'none',
        textVerbosity: 'medium',
      }
    }
    const model = (typeof p.model === 'string' && p.model.trim()) ? p.model.trim() : 'gpt-4o-mini'
    const streaming = (typeof p.streaming === 'boolean') ? p.streaming : true
    const id = (typeof p.id === 'string' && p.id.trim()) ? p.id.trim() : null
    const maxOutputTokens = toIntOrNull(p.maxOutputTokens)
    const topP = toClampedNumber(p.topP, 0, 1)
    const temperature = toClampedNumber(p.temperature, 0, 2)
    const reasoningEffort = normalizeReasoning(p.reasoningEffort)
    const textVerbosity = normalizeVerbosity(p.textVerbosity)
    return { id, model, streaming, maxOutputTokens, topP, temperature, reasoningEffort, textVerbosity }
  }
  function pickPresetFromSettings(state) {
    const list = Array.isArray(state?.presets) ? state.presets : []
    if (typeof state?.selectedPresetId === 'string') {
      const sel = list.find(p => p?.id === state.selectedPresetId)
      if (sel) return normalizePreset(sel)
    }
    if (list.length) return normalizePreset(list[0])
    return normalizePreset(null)
  }
  function presetSignature(state) {
    const list = Array.isArray(state?.presets) ? state.presets : []
    return list.map(p => [
      p?.id || '',
      p?.name || '',
      p?.model || '',
      typeof p?.streaming === 'boolean' ? (p.streaming ? 1 : 0) : 1,
      p?.maxOutputTokens ?? '',
      p?.topP ?? '',
      p?.temperature ?? '',
      p?.reasoningEffort || '',
      p?.textVerbosity || '',
    ].join('|')).join(';')
  }
  const initialPreset = pickPresetFromSettings(initialSettings)
  // Group per-chat settings in a single object (seeded from global defaults)
  let chatSettings = $state({
    model: initialPreset.model,
    streaming: initialPreset.streaming,
    presetId: initialPreset.id,
    maxOutputTokens: initialPreset.maxOutputTokens,
    topP: initialPreset.topP,
    temperature: initialPreset.temperature,
    reasoningEffort: initialPreset.reasoningEffort,
    textVerbosity: initialPreset.textVerbosity,
  })
  // Per-chat settings popover open state
  let chatSettingsOpen = $state(false)
  // Cached models (for datalist)
  let modelIds = $state(loadModelsCache().ids || [])
  let editingId = $state(null)
  let editingText = $state('')
  // editing DOM is handled in MessageBubble
  // Branching helpers (node-based)
  import { buildVisible as _buildVisible, buildVisibleUpTo as _buildVisibleUpTo, findParentId, validateTree, enforceUniqueParents } from './branching.js'
  function buildVisible() { return _buildVisible(nodes, rootId) }
  function buildVisibleUpTo(indexExclusive) { return _buildVisibleUpTo(nodes, rootId, indexExclusive) }
  // Graph root node id (each node stores its active variant index)
  let rootId = $state(1)
  // Validate chat graph integrity and surface issues to the user
  let integrity = $derived(validateTree(nodes, rootId))
  const BUG_NOTICE = 'This indicates a bug in the app. Please try to reproduce it and report it.'
  const DEBUG_AUTOFIX_NOTICE = 'Autofix is disabled in debug mode.'
  let sanitizerNotice = $state('')
  let validationNotice = $derived(!integrity.ok ? `Chat structure issues detected: ${integrity.problems.join(' • ')}. ${BUG_NOTICE}${debug ? ` ${DEBUG_AUTOFIX_NOTICE}` : ''}` : '')
  // Surface latest generation error (if any) via shared notice infrastructure
  let generationNotice = $derived((() => {
    try {
      const vis = buildVisible()
      for (let i = vis.length - 1; i >= 0; i--) {
        const mm = vis[i]?.m
        if (mm?.error) {
          const msg = String(mm.error || '')
          return msg.startsWith('Error:') ? msg : `Error: ${msg}`
        }
      }
    } catch {}
    return ''
  })())
  // Track last dismissed notice to avoid re-showing the same text
  let dismissedNotice = $state('')
  let assembledNotice = $derived([generationNotice, sanitizerNotice, validationNotice].filter(Boolean).join(' '))
  let visibleNotice = $derived((assembledNotice && assembledNotice !== dismissedNotice) ? assembledNotice : '')
  function dismissNotice() { dismissedNotice = assembledNotice }
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
      const maxId = (nodes || []).reduce((mx, n) => {
        const vMax = (n?.variants || []).reduce((m2, v) => Math.max(m2, Number(v?.id) || 0), 0)
        return Math.max(mx, vMax)
      }, 0)
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
      try { saveChatContent(lastChatId, { nodes, settings: chatSettings, rootId }) } catch {}
    }
    lastChatId = cid
    // Reset runtime state whenever switching chats
    ready = false
    // Reset persistence signature to avoid carrying it across chats
    persistSig = ''
    if (!cid) return
    // Compute the new state first, then apply it in a macrotask to avoid
    // mutating state during the current reconciliation/flush.
    let nextNodes = []
    let nextRootId = 1
    let nextSettings = loadSettings()
    let basePreset = pickPresetFromSettings(nextSettings)
    let nextChatSettings = {
      model: basePreset.model,
      streaming: basePreset.streaming,
      presetId: basePreset.id,
      maxOutputTokens: basePreset.maxOutputTokens,
      topP: basePreset.topP,
      temperature: basePreset.temperature,
      reasoningEffort: basePreset.reasoningEffort,
      textVerbosity: basePreset.textVerbosity,
    }
    let nextNextId = 1
    let nextNextNodeId = 1
    let nextPersistSig = ''
    loadChatById(cid).then((loaded) => {
      try {
        if (loaded) {
          if (Array.isArray(loaded.nodes)) {
            nextNodes = loaded.nodes.slice()
            nextRootId = loaded?.rootId || (nextNodes[0]?.id || 1)
          } else {
            // Legacy support: migrate flat/graph messages to node-based
            const msgs = Array.isArray(loaded.messages) ? loaded.messages.slice() : []
          const mig = migrateLegacyGraphToNodes(msgs, loaded?.rootId, loaded?.selected)
          nextNodes = mig.nodes
          nextRootId = mig.rootId
        }
          nextChatSettings = {
            model: loaded?.settings?.model || basePreset.model || 'gpt-4o-mini',
            streaming: (typeof loaded?.settings?.streaming === 'boolean'
              ? loaded.settings.streaming
              : (typeof basePreset.streaming === 'boolean' ? basePreset.streaming : true)),
            presetId: (typeof loaded?.presetId === 'string') ? loaded.presetId : basePreset.id,
            maxOutputTokens: toIntOrNull(hasOwn(loaded?.settings, 'maxOutputTokens') ? loaded.settings.maxOutputTokens : basePreset.maxOutputTokens),
            topP: toClampedNumber(hasOwn(loaded?.settings, 'topP') ? loaded.settings.topP : basePreset.topP, 0, 1),
            temperature: toClampedNumber(hasOwn(loaded?.settings, 'temperature') ? loaded.settings.temperature : basePreset.temperature, 0, 2),
            reasoningEffort: normalizeReasoning(hasOwn(loaded?.settings, 'reasoningEffort') ? loaded.settings.reasoningEffort : basePreset.reasoningEffort),
            textVerbosity: normalizeVerbosity(hasOwn(loaded?.settings, 'textVerbosity') ? loaded.settings.textVerbosity : basePreset.textVerbosity),
          }
          if (!nextNodes.length) {
            nextNextId = 2
            nextNextNodeId = 2
            nextNodes = [{ id: 1, variants: [{ ...makeSystemPrologue(1) }], active: 0 }]
            nextRootId = 1
          } else {
            try {
              const maxMsgId = (nextNodes || []).reduce((mx, n) => {
                const vMax = (n?.variants || []).reduce((mm, v) => Math.max(mm, Number(v?.id) || 0), 0)
                return Math.max(mx, vMax)
              }, 0)
              const maxNodeId = (nextNodes || []).reduce((mx, n) => Math.max(mx, Number(n?.id) || 0), 0)
              nextNextId = maxMsgId + 1
              nextNextNodeId = maxNodeId + 1
            } catch { nextNextId = 1; nextNextNodeId = 1 }
          }
        } else {
          nextNodes = [{ id: 1, variants: [{ ...makeSystemPrologue(1) }], active: 0 }]
          nextRootId = 1
          nextNextId = 2
          nextNextNodeId = 2
          basePreset = pickPresetFromSettings(nextSettings)
          nextChatSettings = {
            model: basePreset.model,
            streaming: basePreset.streaming,
            presetId: basePreset.id,
            maxOutputTokens: basePreset.maxOutputTokens,
            topP: basePreset.topP,
            temperature: basePreset.temperature,
            reasoningEffort: basePreset.reasoningEffort,
            textVerbosity: basePreset.textVerbosity,
          }
        }
      } catch {
        nextSettings = loadSettings()
        basePreset = pickPresetFromSettings(nextSettings)
        nextNodes = [{ id: 1, variants: [{ ...makeSystemPrologue(1) }], active: 0 }]
        nextRootId = 1
        nextNextId = 2
        nextNextNodeId = 2
        nextChatSettings = {
          model: basePreset.model,
          streaming: basePreset.streaming,
          presetId: basePreset.id,
          maxOutputTokens: basePreset.maxOutputTokens,
          topP: basePreset.topP,
          temperature: basePreset.temperature,
          reasoningEffort: basePreset.reasoningEffort,
          textVerbosity: basePreset.textVerbosity,
        }
      }
      // Precompute a persist signature for the loaded chat content
      try {
        const mini = (nextNodes || []).map(n => {
          const v = (n?.variants || [])[Number(n?.active) || 0]
          return `${n.id}|${v?.role||''}|${v?.content?.length||0}|${(v?.next!=null?1:0)}`
        })
        nextPersistSig = JSON.stringify({
          m: mini,
          settings: {
            model: nextChatSettings?.model || '',
            streaming: !!nextChatSettings?.streaming,
            presetId: nextChatSettings?.presetId || '',
            maxOutputTokens: nextChatSettings?.maxOutputTokens ?? null,
            topP: nextChatSettings?.topP ?? null,
            temperature: nextChatSettings?.temperature ?? null,
            reasoningEffort: nextChatSettings?.reasoningEffort || '',
            textVerbosity: nextChatSettings?.textVerbosity || '',
          },
          rootId: nextRootId,
        })
      } catch { nextPersistSig = '' }
      // Apply computed state after the current tick
      setTimeout(() => {
        try {
          settings = nextSettings
          nodes = nextNodes
          nextId = nextNextId
          nextNodeId = nextNextNodeId
          chatSettings = nextChatSettings
          rootId = nextRootId
          editingId = null
          editingText = ''
          dismissedNotice = ''
          // Align persistence signature to loaded state
          persistSig = nextPersistSig
        } finally {
          ready = true
        }
      }, 0)
    }).catch(() => {
      nextSettings = loadSettings()
      basePreset = pickPresetFromSettings(nextSettings)
      nextNodes = [{ id: 1, variants: [{ ...makeSystemPrologue(1) }], active: 0 }]
      nextRootId = 1
      nextNextId = 2
      nextNextNodeId = 2
      nextChatSettings = {
        model: basePreset.model,
        streaming: basePreset.streaming,
        presetId: basePreset.id,
        maxOutputTokens: basePreset.maxOutputTokens,
        topP: basePreset.topP,
        temperature: basePreset.temperature,
        reasoningEffort: basePreset.reasoningEffort,
        textVerbosity: basePreset.textVerbosity,
      }
      try {
        const mini = (nextNodes || []).map(n => {
          const v = (n?.variants || [])[Number(n?.active) || 0]
          return `${n.id}|${v?.role||''}|${v?.content?.length||0}|${(v?.next!=null?1:0)}`
        })
        nextPersistSig = JSON.stringify({
          m: mini,
          settings: {
            model: nextChatSettings?.model || '',
            streaming: !!nextChatSettings?.streaming,
            presetId: nextChatSettings?.presetId || '',
            maxOutputTokens: nextChatSettings?.maxOutputTokens ?? null,
            topP: nextChatSettings?.topP ?? null,
            temperature: nextChatSettings?.temperature ?? null,
            reasoningEffort: nextChatSettings?.reasoningEffort || '',
            textVerbosity: nextChatSettings?.textVerbosity || '',
          },
          rootId: nextRootId,
        })
      } catch { nextPersistSig = '' }
      setTimeout(() => {
        try {
          settings = nextSettings
          nodes = nextNodes
          nextId = nextNextId
          nextNodeId = nextNextNodeId
          chatSettings = nextChatSettings
          rootId = nextRootId
          editingId = null
          editingText = ''
          dismissedNotice = ''
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
      locked = !!(sending || (Array.isArray(nodes) && nodes.some(n => (n?.variants || []).some(v => v?.typing))))
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

  // Re-read settings (including debug flag) when settingsVersion changes
  // Guard against running on every flush by tracking the last applied version.
  let lastSettingsVersion = 0
  $effect(() => {
    const v = Number(props.settingsVersion) || 0
    if (v === lastSettingsVersion) return
    lastSettingsVersion = v
    try {
      const next = loadSettings()
      // Only update if something actually changed to avoid unnecessary flushes
      const changed = (
        settings?.apiKey !== next.apiKey ||
        presetSignature(settings) !== presetSignature(next) ||
        settings?.selectedPresetId !== next?.selectedPresetId ||
        !!settings?.debug !== !!next?.debug
      )
      if (changed) {
        settings = next
        debug = !!next?.debug
      }
    } catch {}
  })

  // Persist chat content and settings on change
  // Keep the signature non-reactive to avoid effect feedback loops
  let persistSig = ''
  // Ensure graph invariant: no node has multiple parents
  function sanitizeGraphIfNeeded() {
    if (debug) return // allow broken graphs in debug mode
    try {
      const check = validateTree(nodes, rootId)
      if (check?.details?.multipleParents && check.details.multipleParents.size > 0) {
        // Record a user-facing notice before mutating
        try {
          const ids = [...check.details.multipleParents.keys()]
          const sample = ids.slice(0, 5).join(', ')
          const more = ids.length > 5 ? '…' : ''
          sanitizerNotice = `Auto-fixed chat structure issue: multiple parents detected for node(s) ${sample}${more}. ${BUG_NOTICE}`
        } catch { sanitizerNotice = `Auto-fixed chat structure issue: multiple parents detected. ${BUG_NOTICE}` }
        const sanitized = enforceUniqueParents(nodes, rootId)
        nodes = sanitized
      }
    } catch {}
  }
  function computePersistSig() {
    try {
      const mini = (nodes || []).map(n => {
        const v = (n?.variants || [])[Number(n?.active) || 0]
        return `${n.id}|${v?.role||''}|${v?.content?.length||0}|${(v?.next!=null?1:0)}`
      })
      return JSON.stringify({
        m: mini,
        settings: {
          model: chatSettings?.model || '',
          streaming: !!chatSettings?.streaming,
          presetId: chatSettings?.presetId || '',
          maxOutputTokens: chatSettings?.maxOutputTokens ?? null,
          topP: chatSettings?.topP ?? null,
          temperature: chatSettings?.temperature ?? null,
          reasoningEffort: chatSettings?.reasoningEffort || '',
          textVerbosity: chatSettings?.textVerbosity || '',
        },
        rootId,
      })
    } catch { return String(Math.random()) }
  }
  // Immediate persistence helper to avoid relying solely on the reactive effect
  async function persistNow() {
    try {
      // Enforce invariant before persisting
      sanitizeGraphIfNeeded()
      const cid = props.chatId
      if (!cid || !mounted) return
      // Persist full graph
      const updated = await saveChatContent(cid, { nodes, settings: chatSettings, rootId })
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
      // Enforce invariant proactively on any change
      sanitizeGraphIfNeeded()
      const sig = computePersistSig()
      if (sig === persistSig) return
      persistSig = sig
      const p = saveChatContent(cid, { nodes, settings: chatSettings, rootId })
      p.then(updated => scheduleParentRefresh(updated)).catch(() => {})
    } catch {}
  })

  

  // Send a message (with chosen role) and request an assistant reply via API
  async function sendWithRole(role = 'user') {
    if (locked) return
    const text = input.trim()
    if (!text || sending) return

    sending = true
    // Attach new node after the last visible node
    const visible = buildVisible()
    const lastVm = visible.length ? visible[visible.length - 1] : null
    const parentNodeId = lastVm ? lastVm.nodeId : null
    const newMsg = { id: nextId++, role, content: text, time: Date.now(), typing: false, error: undefined, next: null }
    const newNode = { id: nextNodeId++, variants: [newMsg], active: 0 }
    let arr = nodes.slice()
    arr.push(newNode)
    if (parentNodeId != null) {
      arr = arr.map(n => (n.id === parentNodeId
        ? { ...n, variants: n.variants.map((v, i) => (i === (Number(n.active)||0) ? { ...v, next: newNode.id } : v)) }
        : n))
    } else {
      rootId = newNode.id
    }
    nodes = arr
    input = ''
    persistNow()
    queueMicrotask(() => scrollToBottom())

    // Typing placeholder + stream if user
    let typingVariant = null
    if (role === 'user') {
      typingVariant = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true, error: undefined, next: null }
      const typingNode = { id: nextNodeId++, variants: [typingVariant], active: 0 }
      nodes = nodes.map(n => (n.id === newNode.id
        ? { ...n, variants: n.variants.map((v, i) => (i === 0 ? { ...v, next: typingNode.id } : v)) }
        : n))
      nodes = [...nodes, typingNode]
    }
    try {
      let reply
      settings = loadSettings()
      const { apiKey } = settings
      if (role === 'user' && apiKey) {
        const history = buildVisible()
          .map(vm => vm.m)
          .filter(m => !m.typing)
          .map(({ role, content }) => ({ role, content }))
        const responseOptions = {
          messages: history,
          model: chatSettings.model,
          maxOutputTokens: chatSettings.maxOutputTokens,
          topP: chatSettings.topP,
          temperature: chatSettings.temperature,
          reasoningEffort: chatSettings.reasoningEffort,
          textVerbosity: chatSettings.textVerbosity,
        }
        if (chatSettings.streaming && typingVariant) {
          reply = await respond({
            ...responseOptions,
            stream: true,
            onTextDelta: (full) => {
              nodes = nodes.map(n => ({
                ...n,
                variants: (n.variants || []).map(v => (v.id === typingVariant.id ? { ...v, content: full } : v))
              }))
            }
          })
        } else if (role === 'user') {
          reply = await respond(responseOptions)
        }
      } else if (role === 'user') {
        reply = generatePlaceholderReply(newMsg.content) +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      if (role === 'user' && typingVariant) {
        nodes = nodes.map(n => ({
          ...n,
          variants: (n.variants || []).map(v => (v.id === typingVariant.id ? { ...v, content: reply, typing: false, error: undefined } : v))
        }))
      }
      persistNow()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      if (role === 'user' && typingVariant) {
        nodes = nodes.map(n => ({
          ...n,
          variants: (n.variants || []).map(v => (v.id === typingVariant.id ? { ...v, typing: false, error: msg, content: (v.content === 'typing' ? '' : v.content) } : v))
        }))
      }
      persistNow()
    } finally {
      sending = false
    }
  }

  // Default send: as user
  function send() { return sendWithRole('user') }

  // Add a message locally without sending to the API
  function addToChat(role = 'user') {
    if (locked) return
    const text = input.trim()
    if (!text) return
    const variant = { id: nextId++, role, content: text, time: Date.now(), typing: false, error: undefined, next: null }
    const node = { id: nextNodeId++, variants: [variant], active: 0 }
    const visible = buildVisible()
    const lastVm = visible.at(-1)
    let arr = nodes.slice()
    arr.push(node)
    if (lastVm) {
      arr = arr.map(n => (n.id === lastVm.nodeId
        ? { ...n, variants: n.variants.map((v, i) => (i === (Number(n.active)||0) ? { ...v, next: node.id } : v)) }
        : n))
    } else {
      rootId = node.id
    }
    nodes = arr
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
  function deleteMessage(messageId) {
    if (locked) return
    // Find node containing this message id
    const loc = (function findNodeByMessageId(mid){ for (const n of nodes||[]) { const i=(n?.variants||[]).findIndex(v=>v?.id===mid); if(i>=0) return {node:n,index:i} } return {node:null,index:-1} })(messageId)
    if (!loc?.node) return
    if (loc.node.id === rootId) return // do not allow deleting root node
    // Collect subtree starting from this node by following any variant next pointers
    const toDelete = new Set()
    function collect(nodeId) {
      if (toDelete.has(nodeId)) return
      toDelete.add(nodeId)
      const n = nodes.find(nn => nn.id === nodeId)
      for (const v of n?.variants || []) { if (v?.next != null) collect(v.next) }
    }
    collect(loc.node.id)
    // Remove nodes and clean dangling next pointers
    const remaining = nodes.filter(n => !toDelete.has(n.id))
    const cleaned = remaining.map(n => ({
      ...n,
      variants: (n.variants || []).map(v => (toDelete.has(Number(v?.next)) ? { ...v, next: null } : v))
    }))
    nodes = cleaned
    persistNow()
  }
  function setMessageRole(id, role) {
    if (locked) return
    // Role change should behave like content change: do not alter branching.
    const roles = new Set(['user', 'assistant', 'system'])
    if (!roles.has(role)) return
    nodes = nodes.map(n => ({
      ...n,
      variants: (n.variants || []).map(v => (v.id === id ? { ...v, role } : v))
    }))
    persistNow()
    // Do not scroll when switching roles
  }
  // Reorder adjacent nodes along the current visible path (node/variant graph)
  function moveUp(messageId) {
    if (locked) return
    const path = buildVisible()
    const idx = path.findIndex(vm => vm.m.id === messageId)
    if (idx <= 0) return
    const B = path[idx]
    const A = path[idx - 1]
    const P = (idx - 2 >= 0) ? path[idx - 2] : null
    const C = (idx + 1 < path.length) ? path[idx + 1] : null
    if (!A || !B) return
    if (B.m?.typing) return
    let arr = nodes.slice()
    function setActiveNext(mid, toId) {
      arr = arr.map(n => (n.id === mid
        ? { ...n, variants: n.variants.map((v, i) => (i === (Number(n.active)||0) ? { ...v, next: toId ?? null } : v)) }
        : n))
    }
    if (P) { setActiveNext(P.nodeId, B.nodeId) } else { rootId = B.nodeId }
    setActiveNext(B.nodeId, A.nodeId)
    setActiveNext(A.nodeId, C ? C.nodeId : null)
    nodes = arr
    persistNow()
  }

  // Reorder adjacent nodes downward along the visible path (node/variant graph)
  function moveDown(messageId) {
    if (locked) return
    const path = buildVisible()
    const idx = path.findIndex(vm => vm.m.id === messageId)
    if (idx < 0 || idx >= (path.length - 1)) return
    const B = path[idx]
    const C = path[idx + 1]
    const P = (idx - 1 >= 0) ? path[idx - 1] : null
    const D = (idx + 2 < path.length) ? path[idx + 2] : null
    if (!B || !C) return
    if (B.m?.typing) return
    let arr = nodes.slice()
    function setActiveNext(mid, toId) {
      arr = arr.map(n => (n.id === mid
        ? { ...n, variants: n.variants.map((v, i) => (i === (Number(n.active)||0) ? { ...v, next: toId ?? null } : v)) }
        : n))
    }
    if (P) { setActiveNext(P.nodeId, C.nodeId) } else { rootId = C.nodeId }
    setActiveNext(C.nodeId, B.nodeId)
    setActiveNext(B.nodeId, D ? D.nodeId : null)
    nodes = arr
    persistNow()
  }
  function moveDownLegacy(id) {
    if (locked) return
    return
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
    const loc = (function findNodeByMessageId(mid){ for (const n of nodes||[]) { const i=(n?.variants||[]).findIndex(v=>v?.id===mid); if(i>=0) return {node:n,index:i} } return {node:null,index:-1} })(id)
    const msg = loc?.node?.variants?.[loc.index]
    if (!msg || msg.typing) return
    editingId = id
    editingText = msg.content || ''
    // Focus/caret handled by MessageBubble when entering edit mode
  }
  function commitEdit() {
    if (locked) return
    if (editingId == null) return
    const val = String(editingText)
    nodes = nodes.map(n => ({
      ...n,
      variants: (n.variants || []).map(v => (v.id === editingId ? { ...v, content: val, error: undefined } : v))
    }))
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
    const loc = (function findNodeByMessageId(mid){ for (const n of nodes||[]) { const i=(n?.variants||[]).findIndex(v=>v?.id===mid); if(i>=0) return {node:n,index:i} } return {node:null,index:-1} })(editingId)
    const curNode = loc?.node
    const cur = curNode?.variants?.[loc.index]
    if (!curNode || !cur) return
    const val = String(editingText)
    // Important: a branch should not inherit the existing variant's `next`.
    // Start a fresh path by clearing `next` on the new variant.
    const newVariant = { id: nextId++, role: cur.role, content: val, time: Date.now(), typing: false, error: undefined, next: null }
    nodes = nodes.map(n => (n.id === curNode.id ? { ...n, variants: [...(n.variants || []), newVariant], active: (n.variants?.length || 0) } : n))
    persistNow()
    editingId = null
    editingText = ''
    queueMicrotask(() => scrollToBottom())
  }

  // Branch and generate a new assistant reply starting after the edited message
  async function applyEditSend() {
    if (locked) return
    if (editingId == null) return
    const loc = (function findNodeByMessageId(mid){ for (const n of nodes||[]) { const i=(n?.variants||[]).findIndex(v=>v?.id===mid); if(i>=0) return {node:n,index:i} } return {node:null,index:-1} })(editingId)
    const curNode = loc?.node
    const cur = curNode?.variants?.[loc.index]
    if (!curNode || !cur) return
    const val = String(editingText)
    // Special case: if nothing changed and this is the last visible message,
    // do not branch. For user messages, just generate the following reply.
    try {
      const path = buildVisible()
      const insertIndex = path.findIndex(vm => vm.nodeId === curNode.id)
      const isLast = insertIndex >= 0 && insertIndex === (path.length - 1)
      const noChange = (val === (cur.content || ''))
      if (noChange && isLast) {
        // Clear edit state and generate reply after this message (no branching)
        editingId = null
        editingText = ''
        await refreshAfterUserIndex(insertIndex)
        return
      }
    } catch {}
    // 1) Add a new variant and select it
    const branched = { id: nextId++, role: cur.role, content: val, time: Date.now(), typing: false, error: undefined, next: null }
    nodes = nodes.map(n => (n.id === curNode.id ? { ...n, variants: [...(n.variants || []), branched], active: (n.variants?.length || 0) } : n))
    persistNow()
    editingId = null
    editingText = ''

    // 2) Generate a new assistant reply after the branched variant
    const typingMsg = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true, next: null }
    const typingNode = { id: nextNodeId++, variants: [typingMsg], active: 0 }
    nodes = nodes.map(n => (n.id === curNode.id ? { ...n, variants: n.variants.map((v, i) => (i === (n.variants.length - 1) ? { ...v, next: typingNode.id } : v)) } : n))
    nodes = [...nodes, typingNode]
    
    try {
      let reply
      settings = loadSettings()
      const { apiKey } = settings
      const path = buildVisible()
      const insertIndex = path.findIndex(vm => vm.nodeId === curNode.id)
      const history = buildVisibleUpTo(insertIndex + 1)
        .filter(m => !m.typing)
        .map(({ role, content }) => ({ role, content }))
      if (apiKey) {
        const responseOptions = {
          messages: history,
          model: chatSettings.model,
          maxOutputTokens: chatSettings.maxOutputTokens,
          topP: chatSettings.topP,
          temperature: chatSettings.temperature,
          reasoningEffort: chatSettings.reasoningEffort,
          textVerbosity: chatSettings.textVerbosity,
        }
        if (chatSettings.streaming) {
          reply = await respond({
            ...responseOptions,
            stream: true,
            onTextDelta: (full) => {
              nodes = nodes.map(n => ({ ...n, variants: (n.variants || []).map(v => (v.id === typingMsg.id ? { ...v, content: full } : v)) }))
            }
          })
        } else {
          reply = await respond(responseOptions)
        }
      } else {
        const lastUser = [...buildVisibleUpTo(insertIndex + 1)].reverse().find(m => m.role === 'user')
        reply = generatePlaceholderReply(lastUser?.content || val) +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      nodes = nodes.map(n => ({ ...n, variants: (n.variants || []).map(v => (v.id === typingMsg.id ? { ...v, content: reply, typing: false, error: undefined } : v)) }))
      persistNow()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      nodes = nodes.map(n => ({ ...n, variants: (n.variants || []).map(v => (v.id === typingMsg.id ? { ...v, typing: false, error: msg, content: (v.content === 'typing' ? '' : v.content) } : v)) }))
      persistNow()
    } finally {
      // Do not auto-scroll on reply
    }
  }
  function cancelEdit() {
    editingId = null
    editingText = ''
  }

  // Debug: clone a variant but keep its existing next pointer (intentionally breaks invariant)
  function debugFuckUpBranch(id) {
    if (locked) return
    const loc = (function findNodeByMessageId(mid){ for (const n of nodes||[]) { const i=(n?.variants||[]).findIndex(v=>v?.id===mid); if(i>=0) return {node:n,index:i} } return {node:null,index:-1} })(id)
    const node = loc?.node
    const cur = node?.variants?.[loc.index]
    if (!node || !cur) return
    const branched = { id: nextId++, role: cur.role, content: cur.content, time: Date.now(), typing: false, error: undefined, next: (cur.next != null ? cur.next : null) }
    nodes = nodes.map(n => (n.id === node.id ? { ...n, variants: [...(n.variants || []), branched], active: (n.variants?.length || 0) } : n))
    persistNow()
  }

  

  // Removed global auto-scroll effect to avoid scrolling on replies/role changes

  // Branch: regenerate an assistant message by creating a new variant in-place
  async function refreshAssistant(id) {
    if (locked) return
    const loc = (function findNodeByMessageId(mid){ for (const n of nodes||[]) { const i=(n?.variants||[]).findIndex(v=>v?.id===mid); if(i>=0) return {node:n,index:i} } return {node:null,index:-1} })(id)
    const node = loc?.node
    const target = node?.variants?.[loc.index]
    if (!node || !target || target.role !== 'assistant' || target.typing) return
    // Create a new assistant variant within the same node and stream into it
    // Important: do NOT inherit the old variant's `next` pointer.
    // This is a branch; it should end at the regenerated response.
    const typingMsg = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true, error: undefined, next: null }
    nodes = nodes.map(n => (n.id === node.id ? { ...n, variants: [...(n.variants || []), typingMsg], active: (n.variants?.length || 0) } : n))
    try {
      let reply
      settings = loadSettings()
      const { apiKey } = settings
      if (apiKey) {
        // Build history up to (but not including) this assistant node (parent path)
        const path = buildVisible()
        const parentPathIndex = path.findIndex(vm => vm.nodeId === node.id) - 1
        const history = buildVisibleUpTo((parentPathIndex >= 0 ? parentPathIndex + 1 : 0))
          .filter(m => !m.typing)
          .map(({ role, content }) => ({ role, content }))
        const responseOptions = {
          messages: history,
          model: chatSettings.model,
          maxOutputTokens: chatSettings.maxOutputTokens,
          topP: chatSettings.topP,
          temperature: chatSettings.temperature,
          reasoningEffort: chatSettings.reasoningEffort,
          textVerbosity: chatSettings.textVerbosity,
        }
        if (chatSettings.streaming) {
          reply = await respond({
            ...responseOptions,
            stream: true,
            onTextDelta: (full) => {
              nodes = nodes.map(n => ({
                ...n,
                variants: (n.variants || []).map(v => (v.id === typingMsg.id ? { ...v, content: full } : v))
              }))
            }
          })
        } else {
          reply = await respond(responseOptions)
        }
      } else {
        const path = buildVisible()
        const lastUser = [...path.map(vm => vm.m)].reverse().find(m => m.role === 'user')
        reply = generatePlaceholderReply(lastUser?.content || 'Regenerated response') +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      nodes = nodes.map(n => ({
        ...n,
        variants: (n.variants || []).map(v => (v.id === typingMsg.id ? { ...v, typing: false, error: undefined, content: reply } : v))
      }))
      persistNow()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      nodes = nodes.map(n => ({
        ...n,
        variants: (n.variants || []).map(v => (v.id === typingMsg.id ? { ...v, typing: false, error: msg, content: (v.content === 'typing' ? '' : v.content) } : v))
      }))
      persistNow()
    } finally {
      // Do not auto-scroll on reply
    }
  }

  // Generate a new assistant reply directly after a given message index
  // (used when refreshing a message with no following assistant)
  async function refreshAfterUserIndex(i) {
    if (locked) return
    const path = buildVisible()
    const vm = (typeof i === 'number') ? path[i] : null
    const curMsg = vm?.m
    const curNodeId = vm?.nodeId
    if (!curMsg || !curNodeId) return
    // Add typing assistant node after this message
    const typingMsg = { id: nextId++, role: 'assistant', content: 'typing', time: Date.now(), typing: true, next: null }
    const typingNode = { id: nextNodeId++, variants: [typingMsg], active: 0 }
    nodes = nodes.map(n => (n.id === curNodeId ? { ...n, variants: n.variants.map((v, idx) => (idx === (Number(n.active)||0) ? { ...v, next: typingNode.id } : v)) } : n))
    nodes = [...nodes, typingNode]
    persistNow()

    try {
      let reply
      settings = loadSettings()
      const { apiKey } = settings
      const history = buildVisibleUpTo(i + 1)
        .filter(m => !m.typing)
        .map(({ role, content }) => ({ role, content }))
      if (apiKey) {
        const responseOptions = {
          messages: history,
          model: chatSettings.model,
          maxOutputTokens: chatSettings.maxOutputTokens,
          topP: chatSettings.topP,
          temperature: chatSettings.temperature,
          reasoningEffort: chatSettings.reasoningEffort,
          textVerbosity: chatSettings.textVerbosity,
        }
        if (chatSettings.streaming) {
          reply = await respond({
            ...responseOptions,
            stream: true,
            onTextDelta: (full) => {
              nodes = nodes.map(n => ({ ...n, variants: (n.variants || []).map(v => (v.id === typingMsg.id ? { ...v, content: full } : v)) }))
            }
          })
        } else {
          reply = await respond(responseOptions)
        }
      } else {
        const lastUser = [...buildVisibleUpTo(i + 1)].reverse().find(m => m.role === 'user')
        reply = generatePlaceholderReply(lastUser?.content || curMsg.content) +
          '\n\nTip: Add your OpenAI API key in Settings to get real answers.'
      }
      nodes = nodes.map(n => ({ ...n, variants: (n.variants || []).map(v => (v.id === typingMsg.id ? { ...v, content: reply, typing: false, error: undefined } : v)) }))
      persistNow()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      nodes = nodes.map(n => ({ ...n, variants: (n.variants || []).map(v => (v.id === typingMsg.id ? { ...v, typing: false, error: msg, content: (v.content === 'typing' ? '' : v.content) } : v)) }))
      persistNow()
    } finally {
      // Do not auto-scroll on reply
    }
  }
  
  function changeVariant(messageId, delta) {
    if (locked) return
    const loc = (function findNodeByMessageId(mid){ for (const n of nodes||[]) { const i=(n?.variants||[]).findIndex(v=>v?.id===mid); if(i>=0) return {node:n,index:i} } return {node:null,index:-1} })(messageId)
    const parent = loc?.node
    if (!parent || (parent.variants || []).length <= 1) return
    const len = parent.variants.length
    const cur = Number(parent.active) || 0
    const next = Math.max(0, Math.min(len - 1, cur + delta))
    if (next === cur) return
    nodes = nodes.map(n => (n.id === parent.id ? { ...n, active: next } : n))
    persistNow()
  }

  // Legacy migration: flatten old graph-based messages + selection into nodes with single variants
  function migrateLegacyGraphToNodes(messagesArr, legacyRootId, legacySelected) {
    const msgs = Array.isArray(messagesArr) ? messagesArr.slice() : []
    const byId = new Map(msgs.map(m => [m.id, m]))
    const outNodes = []
    let nid = 1
    const nodeIdByMsgId = new Map()
    const now = Date.now()
    for (const m of msgs) {
      const nodeId = nid++
      nodeIdByMsgId.set(m.id, nodeId)
      outNodes.push({ id: nodeId, variants: [{ id: m.id, role: m.role, content: m.content, time: m.time || now, typing: !!m.typing, error: m.error, next: null }], active: 0 })
    }
    // Wire next pointers along selected branches
    for (const m of msgs) {
      const children = Array.isArray(m.next) ? m.next : []
      if (!children.length) continue
      const sel = Math.max(0, Math.min(children.length - 1, Number(legacySelected?.[m.id]) || 0))
      const childMsgId = children[sel]
      const fromNodeId = nodeIdByMsgId.get(m.id)
      const toNodeId = nodeIdByMsgId.get(childMsgId)
      const node = outNodes.find(n => n.id === fromNodeId)
      if (node && toNodeId != null) {
        node.variants = node.variants.map((v, i) => (i === 0 ? { ...v, next: toNodeId } : v))
      }
    }
    const root = (legacyRootId != null) ? nodeIdByMsgId.get(legacyRootId) : (outNodes[0]?.id || 1)
    return { nodes: outNodes, rootId: root }
  }
</script>

<section class="chat-shell">
  <MessageList
    bind:this={listCmp}
    items={buildVisible()}
    notice={visibleNotice}
    total={nodes.length}
    locked={locked}
    debug={debug}
    editingId={editingId}
    editingText={editingText}
    followingMap={computeFollowingMap()}
    onDismissNotice={dismissNotice}
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
    onDebugFuckBranch={(id) => debugFuckUpBranch(id)}
  />

  <Composer
    input={input}
    sending={sending}
    locked={locked}
    chatSettingsOpen={chatSettingsOpen}
    chatModel={chatSettings.model}
    chatStreaming={chatSettings.streaming}
    chatMaxOutputTokens={chatSettings.maxOutputTokens}
    chatTopP={chatSettings.topP}
    chatTemperature={chatSettings.temperature}
    chatReasoningEffort={chatSettings.reasoningEffort}
    chatTextVerbosity={chatSettings.textVerbosity}
    modelIds={modelIds}
    onToggleChatSettings={toggleChatSettings}
    onCloseChatSettings={() => (chatSettingsOpen = false)}
    onChangeModel={(val) => (chatSettings = { ...chatSettings, model: val })}
    onChangeStreaming={(val) => (chatSettings = { ...chatSettings, streaming: !!val })}
    onChangeMaxOutputTokens={(val) => (chatSettings = { ...chatSettings, maxOutputTokens: toIntOrNull(val) })}
    onChangeTopP={(val) => (chatSettings = { ...chatSettings, topP: toClampedNumber(val, 0, 1) })}
    onChangeTemperature={(val) => (chatSettings = { ...chatSettings, temperature: toClampedNumber(val, 0, 2) })}
    onChangeReasoningEffort={(val) => (chatSettings = { ...chatSettings, reasoningEffort: normalizeReasoning(val) })}
    onChangeTextVerbosity={(val) => (chatSettings = { ...chatSettings, textVerbosity: normalizeVerbosity(val) })}
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

  /* Integrity notice now rendered inside MessageList */
</style>
