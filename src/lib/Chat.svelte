<script>
  // Core imports
  import { onMount, onDestroy } from 'svelte'
  import { loadSettings, findConnection } from './settingsStore.js'
  import { ensureModels, loadModelsCache } from './modelsStore.js'
  import { saveChatContent } from './chatsStore.js'
  import { copyText as copyToClipboard } from './utils/clipboard.js'
  import MessageList from './components/chat/MessageList.svelte'
  import Composer from './components/chat/Composer.svelte'

  // Chat module imports
  import { loadChat } from './chat/services/chatLoader.js'
  import { pickPresetFromSettings, presetSignature } from './chat/services/chatInit.js'
  import { persistChatContent, computePersistSig } from './chat/services/chatPersistence.js'
  import { computeValidationNotice, computeGenerationNotice, assembleNotice, computeFollowingMap } from './chat/services/noticeHelpers.js'

  // Action imports
  import { deleteMessage, setMessageRole, moveUp, moveDown } from './chat/actions/messageActions.js'
  import { changeVariant, updateVariantById } from './chat/actions/variantActions.js'
  import { commitEditReplace, applyEditBranch, prepareBranchAndSend } from './chat/actions/editActions.js'
  import {
    prepareUserMessage,
    prepareTypingNode,
    generateResponse,
    handleGenerationSuccess,
    handleGenerationError,
    prepareRefreshAssistant,
    prepareRefreshAfterUser
  } from './chat/actions/generationActions.js'

  // Utilities
  import { toIntOrNull, toClampedNumber } from './utils/numbers.js'
  import { normalizeReasoning, normalizeVerbosity, normalizeReasoningSummary } from './utils/validation.js'
  import { NO_API_KEY_NOTICE_TEXT } from './constants/index.js'
  import { buildVisible as _buildVisible, buildVisibleUpTo as _buildVisibleUpTo } from './branching.js'

  const props = $props()

  // State
  let nodes = $state([])
  let rootId = $state(1)
  let input = $state('')
  let sending = $state(false)
  let inFlightAbort = $state(null)
  let inFlightTypingVariantId = $state(null)
  let abortRequested = $state(false)
  let locked = $state(false)
  let nextId = $state(1)
  let nextNodeId = $state(1)
  let ready = false
  let mounted = false
  let lastChatId = null
  let lastReportedChatId = null
  let lastReportedSending = null

  // Settings & chat configuration
  const initialSettings = loadSettings()
  let settings = $state(initialSettings)
  let debug = $state(!!initialSettings?.debug)
  const initialPreset = pickPresetFromSettings(initialSettings)
  const initialConnectionId = (() => {
    const presetConn = typeof initialPreset?.connectionId === 'string' && initialPreset.connectionId.trim()
      ? initialPreset.connectionId.trim()
      : null
    if (presetConn) return presetConn
    const settingsConn = typeof initialSettings?.selectedConnectionId === 'string' && initialSettings.selectedConnectionId.trim()
      ? initialSettings.selectedConnectionId.trim()
      : null
    return settingsConn
  })()

  let chatSettings = $state({
    model: initialPreset.model,
    streaming: initialPreset.streaming,
    presetId: initialPreset.id,
    maxOutputTokens: initialPreset.maxOutputTokens,
    topP: initialPreset.topP,
    temperature: initialPreset.temperature,
    reasoningEffort: initialPreset.reasoningEffort,
    textVerbosity: initialPreset.textVerbosity,
    reasoningSummary: initialPreset.reasoningSummary,
    connectionId: initialConnectionId,
  })

  let chatSettingsOpen = $state(false)
  let modelIds = $state(loadModelsCache(initialConnectionId).ids || [])
  let persistSig = ''

  // Editing state
  let editingId = $state(null)
  let editingText = $state('')

  // Notices
  let sanitizerNotice = $state('')
  let missingApiKeyNotice = $state('')
  let dismissedNotice = $state('')

  // Derived state
  const connectionOptions = $derived((() => {
    try {
      const list = Array.isArray(settings?.connections) ? settings.connections : []
      return list
        .filter(conn => conn && typeof conn.id === 'string')
        .map(conn => ({ id: conn.id, name: conn.name || conn.id }))
    } catch { return [] }
  })())

  let validationNotice = $derived(computeValidationNotice(nodes, rootId, debug))
  let generationNotice = $derived(computeGenerationNotice(nodes, rootId))
  let assembledNotice = $derived(assembleNotice(generationNotice, sanitizerNotice, validationNotice, missingApiKeyNotice, dismissedNotice))
  let visibleNotice = $derived((assembledNotice && assembledNotice !== dismissedNotice) ? assembledNotice : '')

  // Helper functions
  function buildVisible() { return _buildVisible(nodes, rootId) }
  function buildVisibleUpTo(indexExclusive) { return _buildVisibleUpTo(nodes, rootId, indexExclusive) }

  function resolveConnectionContext() {
    let latestSettings = settings
    try {
      latestSettings = loadSettings()
      settings = latestSettings
    } catch {}
    let activeConnection = null
    try {
      activeConnection = findConnection(latestSettings, chatSettings?.connectionId)
    } catch {}
    const connectionId = activeConnection?.id || chatSettings?.connectionId || latestSettings?.selectedConnectionId || null
    const apiKey = typeof activeConnection?.apiKey === 'string' ? activeConnection.apiKey : ''
    return { latestSettings, activeConnection, connectionId, apiKey }
  }

  function showMissingApiKeyNotice() {
    if (dismissedNotice && dismissedNotice.includes(NO_API_KEY_NOTICE_TEXT)) dismissedNotice = ''
    missingApiKeyNotice = NO_API_KEY_NOTICE_TEXT
  }

  function clearMissingApiKeyNotice() {
    if (missingApiKeyNotice) missingApiKeyNotice = ''
  }

  function dismissNotice() { dismissedNotice = assembledNotice }

  function updateVariant(variantId, transform) {
    nodes = updateVariantById(nodes, variantId, transform)
  }

  // Generation state management
  function resetGenerationState() {
    inFlightAbort = null
    inFlightTypingVariantId = null
    abortRequested = false
  }

  function registerAbortHandler(fn) {
    inFlightAbort = (typeof fn === 'function') ? fn : null
    if (abortRequested && typeof inFlightAbort === 'function') {
      try { inFlightAbort() } catch {}
    }
  }

  function finishGeneration() {
    sending = false
    resetGenerationState()
  }

  // Persistence
  async function persistNow() {
    try {
      const result = await persistChatContent(props.chatId, nodes, chatSettings, rootId, debug, mounted)
      if (result.notice) sanitizerNotice = result.notice
      if (result.nodes !== nodes) nodes = result.nodes
      persistSig = computePersistSig(nodes, chatSettings, rootId)
      scheduleParentRefresh(result.updated)
    } catch {}
  }

  let refreshScheduled = false
  let refreshTimer = null
  function scheduleParentRefresh(updated) {
    if (refreshScheduled) return
    refreshScheduled = true
    refreshTimer && clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshScheduled = false
      refreshTimer = null
      try { props.onChatUpdated?.(updated) } catch {}
    }, 0)
  }

  // Scroll helper
  let listCmp
  function scrollToBottom() {
    try { listCmp?.scrollToBottom?.() } catch {}
  }

  // Message actions
  async function copyMessage(text) {
    try { await copyToClipboard(text) } catch {}
  }

  function handleDeleteMessage(messageId) {
    if (locked) return
    const result = deleteMessage(nodes, rootId, messageId)
    nodes = result.nodes
    rootId = result.rootId
    persistNow()
  }

  function handleSetMessageRole(id, role) {
    if (locked) return
    nodes = setMessageRole(nodes, id, role)
    persistNow()
  }

  function handleMoveUp(messageId) {
    if (locked) return
    const result = moveUp(nodes, rootId, messageId)
    nodes = result.nodes
    rootId = result.rootId
    persistNow()
  }

  function handleMoveDown(messageId) {
    if (locked) return
    const result = moveDown(nodes, rootId, messageId)
    nodes = result.nodes
    rootId = result.rootId
    persistNow()
  }

  function handleChangeVariant(id, delta) {
    if (locked) return
    nodes = changeVariant(nodes, id, delta)
    persistNow()
  }

  // Edit actions
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

  function editMessage(id) {
    if (locked) return
    const loc = (function findNodeByMessageId(mid){ for (const n of nodes||[]) { const i=(n?.variants||[]).findIndex(v=>v?.id===mid); if(i>=0) return {node:n,index:i} } return {node:null,index:-1} })(id)
    const msg = loc?.node?.variants?.[loc.index]
    if (!msg || msg.typing) return
    editingId = id
    editingText = msg.content || ''
  }

  function commitEdit() {
    if (locked) return
    if (editingId == null) return
    nodes = commitEditReplace(nodes, editingId, editingText)
    editingId = null
    editingText = ''
    queueMicrotask(() => scrollToBottom())
    persistNow()
  }

  function applyEditReplace() { commitEdit() }

  function applyBranch() {
    if (locked) return
    if (editingId == null) return
    const result = applyEditBranch(nodes, editingId, editingText, nextId)
    nodes = result.nodes
    nextId = result.nextId
    persistNow()
    editingId = null
    editingText = ''
    queueMicrotask(() => scrollToBottom())
  }

  async function applyEditSend() {
    if (locked) return
    if (editingId == null) return

    const prepared = prepareBranchAndSend(nodes, rootId, editingId, editingText, nextId, nextNodeId)
    if (!prepared) return

    if (prepared.shouldRefreshOnly) {
      editingId = null
      editingText = ''
      await refreshAfterUserIndex(prepared.insertIndex)
      return
    }

    nodes = prepared.nodes
    nextId = prepared.nextId
    nextNodeId = prepared.nextNodeId
    editingId = null
    editingText = ''

    resetGenerationState()
    const { connectionId, apiKey } = resolveConnectionContext()
    if (!apiKey) {
      persistNow()
      showMissingApiKeyNotice()
      return
    }
    clearMissingApiKeyNotice()

    sending = true
    inFlightTypingVariantId = prepared.typingVariantId
    persistNow()

    try {
      let summaryBuffer = ''
      const reply = await generateResponse({
        nodes,
        rootId,
        chatSettings,
        connectionId,
        streaming: chatSettings.streaming,
        typingVariantId: prepared.typingVariantId,
        onAbort: registerAbortHandler,
        onTextDelta: (full) => {
          updateVariant(prepared.typingVariantId, (prev) => ({ ...prev, content: full }))
        },
        onReasoningSummaryDelta: (fullSummary) => {
          if (typeof fullSummary === 'string') summaryBuffer = fullSummary
          updateVariant(prepared.typingVariantId, (prev) => ({
            ...prev,
            reasoningSummary: summaryBuffer,
            reasoningSummaryLoading: true,
          }))
        },
        onReasoningSummaryDone: (fullSummary) => {
          if (typeof fullSummary === 'string') summaryBuffer = fullSummary
          updateVariant(prepared.typingVariantId, (prev) => ({
            ...prev,
            reasoningSummary: summaryBuffer,
            reasoningSummaryLoading: false,
          }))
        },
      })
      nodes = handleGenerationSuccess(nodes, prepared.typingVariantId, reply, summaryBuffer)
      persistNow()
    } catch (err) {
      nodes = handleGenerationError(nodes, prepared.typingVariantId, err)
      persistNow()
    } finally {
      finishGeneration()
    }
  }

  function cancelEdit() {
    editingId = null
    editingText = ''
  }

  // Send message
  async function sendWithRole(role = 'user') {
    if (locked || sending) return
    resetGenerationState()

    const rawInput = (typeof input === 'string') ? input : ''
    const trimmedInput = rawInput.trim()
    const hasContent = trimmedInput.length > 0

    if (!hasContent && role !== 'user') {
      input = ''
      return
    }

    let connectionId = null
    let apiKey = ''
    if (role === 'user') {
      const resolved = resolveConnectionContext()
      connectionId = resolved.connectionId
      apiKey = resolved.apiKey
      if (apiKey) {
        clearMissingApiKeyNotice()
      }
    } else {
      resolveConnectionContext()
    }

    sending = true

    // Add user message
    let newNodeId = null
    if (hasContent) {
      const prepared = prepareUserMessage(nodes, rootId, trimmedInput, nextId, nextNodeId)
      if (prepared) {
        nodes = prepared.nodes
        rootId = prepared.rootId
        nextId = prepared.nextId
        nextNodeId = prepared.nextNodeId
        newNodeId = prepared.newNodeId
      }
    }

    input = ''

    // Add typing node
    let typingVariantId = null
    if (role === 'user' && apiKey) {
      const parentNodeId = (hasContent && newNodeId != null) ? newNodeId : (buildVisible().at(-1)?.nodeId || null)
      const prepared = prepareTypingNode(nodes, rootId, parentNodeId, nextId, nextNodeId)
      nodes = prepared.nodes
      rootId = prepared.rootId
      typingVariantId = prepared.typingVariantId
      inFlightTypingVariantId = typingVariantId
      nextId = prepared.nextId
      nextNodeId = prepared.nextNodeId
    }

    persistNow()
    queueMicrotask(() => scrollToBottom())

    try {
      let reply = null
      let summaryBuffer = ''
      if (role === 'user' && apiKey) {
        reply = await generateResponse({
          nodes,
          rootId,
          chatSettings,
          connectionId,
          streaming: chatSettings.streaming,
          typingVariantId,
          onAbort: registerAbortHandler,
          onTextDelta: (full) => {
            updateVariant(typingVariantId, (prev) => ({ ...prev, content: full }))
          },
          onReasoningSummaryDelta: (fullSummary) => {
            if (typeof fullSummary === 'string') summaryBuffer = fullSummary
            updateVariant(typingVariantId, (prev) => ({
              ...prev,
              reasoningSummary: summaryBuffer,
              reasoningSummaryLoading: true,
            }))
          },
          onReasoningSummaryDone: (fullSummary) => {
            if (typeof fullSummary === 'string') summaryBuffer = fullSummary
            updateVariant(typingVariantId, (prev) => ({
              ...prev,
              reasoningSummary: summaryBuffer,
              reasoningSummaryLoading: false,
            }))
          },
        })
      } else if (role === 'user') {
        showMissingApiKeyNotice()
      }
      if (role === 'user' && typingVariantId != null) {
        nodes = handleGenerationSuccess(nodes, typingVariantId, reply, summaryBuffer)
      }
      persistNow()
    } catch (err) {
      if (role === 'user' && typingVariantId != null) {
        nodes = handleGenerationError(nodes, typingVariantId, err)
      }
      persistNow()
    } finally {
      finishGeneration()
    }
  }

  function send() { return sendWithRole('user') }

  function stopGeneration() {
    if (!sending) return
    abortRequested = true
    const abortFn = inFlightAbort
    if (typeof abortFn === 'function') {
      try { abortFn() } catch {}
    }
    const typingId = inFlightTypingVariantId
    if (typingId != null) {
      updateVariant(typingId, (prev) => ({
        ...prev,
        typing: false,
        error: undefined,
        reasoningSummaryLoading: false,
        content: (prev.content === 'typing' ? '' : prev.content),
      }))
    }
    inFlightAbort = null
    sending = false
    persistNow()
  }

  function addToChat(role = 'user') {
    if (locked) return
    const text = (typeof input === 'string') ? input : ''
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

  // Refresh actions
  async function refreshAssistant(id) {
    if (locked) return
    const prepared = prepareRefreshAssistant(nodes, rootId, id, nextId)
    if (!prepared) return

    resetGenerationState()
    const { connectionId, apiKey } = resolveConnectionContext()
    if (!apiKey) {
      showMissingApiKeyNotice()
      return
    }
    clearMissingApiKeyNotice()

    nodes = prepared.nodes
    nextId = prepared.nextId
    sending = true
    inFlightTypingVariantId = prepared.typingVariantId

    try {
      let summaryBuffer = ''
      const reply = await generateResponse({
        nodes: prepared.nodes,
        rootId,
        chatSettings,
        connectionId,
        streaming: chatSettings.streaming,
        typingVariantId: prepared.typingVariantId,
        onAbort: registerAbortHandler,
        onTextDelta: (full) => {
          updateVariant(prepared.typingVariantId, (prev) => ({ ...prev, content: full }))
        },
        onReasoningSummaryDelta: (fullSummary) => {
          if (typeof fullSummary === 'string') summaryBuffer = fullSummary
          updateVariant(prepared.typingVariantId, (prev) => ({
            ...prev,
            reasoningSummary: summaryBuffer,
            reasoningSummaryLoading: true,
          }))
        },
        onReasoningSummaryDone: (fullSummary) => {
          if (typeof fullSummary === 'string') summaryBuffer = fullSummary
          updateVariant(prepared.typingVariantId, (prev) => ({
            ...prev,
            reasoningSummary: summaryBuffer,
            reasoningSummaryLoading: false,
          }))
        },
      })
      nodes = handleGenerationSuccess(nodes, prepared.typingVariantId, reply, summaryBuffer)
      persistNow()
    } catch (err) {
      nodes = handleGenerationError(nodes, prepared.typingVariantId, err)
      persistNow()
    } finally {
      finishGeneration()
    }
  }

  async function refreshAfterUserIndex(i) {
    if (locked) return
    const prepared = prepareRefreshAfterUser(nodes, rootId, i, nextId, nextNodeId)
    if (!prepared) return

    resetGenerationState()
    const { connectionId, apiKey } = resolveConnectionContext()
    if (!apiKey) {
      showMissingApiKeyNotice()
      return
    }
    clearMissingApiKeyNotice()

    nodes = prepared.nodes
    nextId = prepared.nextId
    nextNodeId = prepared.nextNodeId
    sending = true
    inFlightTypingVariantId = prepared.typingVariantId
    persistNow()

    try {
      let summaryBuffer = ''
      const reply = await generateResponse({
        nodes: prepared.nodes,
        rootId,
        chatSettings,
        connectionId,
        streaming: chatSettings.streaming,
        typingVariantId: prepared.typingVariantId,
        onAbort: registerAbortHandler,
        onTextDelta: (full) => {
          updateVariant(prepared.typingVariantId, (prev) => ({ ...prev, content: full }))
        },
        onReasoningSummaryDelta: (fullSummary) => {
          if (typeof fullSummary === 'string') summaryBuffer = fullSummary
          updateVariant(prepared.typingVariantId, (prev) => ({
            ...prev,
            reasoningSummary: summaryBuffer,
            reasoningSummaryLoading: true,
          }))
        },
        onReasoningSummaryDone: (fullSummary) => {
          if (typeof fullSummary === 'string') summaryBuffer = fullSummary
          updateVariant(prepared.typingVariantId, (prev) => ({
            ...prev,
            reasoningSummary: summaryBuffer,
            reasoningSummaryLoading: false,
          }))
        },
      })
      nodes = handleGenerationSuccess(nodes, prepared.typingVariantId, reply, summaryBuffer)
      persistNow()
    } catch (err) {
      nodes = handleGenerationError(nodes, prepared.typingVariantId, err)
      persistNow()
    } finally {
      finishGeneration()
    }
  }

  // Debug function
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

  // Chat settings
  function toggleChatSettings() {
    chatSettingsOpen = !chatSettingsOpen
  }

  // Lifecycle effects
  $effect(() => {
    const cid = props.chatId
    if (lastChatId && lastChatId !== cid && mounted) {
      try { saveChatContent(lastChatId, { nodes, settings: chatSettings, rootId }) } catch {}
    }
    lastChatId = cid
    ready = false
    persistSig = ''
    if (!cid) return

    loadChat(cid).then((result) => {
      setTimeout(() => {
        try {
          settings = result.settings
          nodes = result.nodes
          nextId = result.nextId
          nextNodeId = result.nextNodeId
          chatSettings = result.chatSettings
          try { modelIds = loadModelsCache(result.chatSettings?.connectionId).ids || [] } catch {}
          rootId = result.rootId
          editingId = null
          editingText = ''
          dismissedNotice = ''
          persistSig = result.persistSig
        } finally {
          ready = true
        }
      }, 0)
    }).catch(() => {
      setTimeout(() => {
        ready = true
      }, 0)
    })
  })

  $effect(() => {
    try {
      locked = !!(sending || (Array.isArray(nodes) && nodes.some(n => (n?.variants || []).some(v => v?.typing))))
    } catch { locked = !!sending }
  })

  $effect(() => {
    const connectionId = chatSettings?.connectionId
    const cached = loadModelsCache(connectionId)
    const cachedIds = cached?.ids || []
    modelIds = cachedIds
    if (!cachedIds.length) {
      ensureModels({ connectionId }).then((fresh) => {
        if (chatSettings?.connectionId === connectionId && Array.isArray(fresh?.ids)) {
          modelIds = fresh.ids
        }
      }).catch(() => {})
    }
  })

  $effect(() => {
    const list = Array.isArray(settings?.connections) ? settings.connections : []
    if (!list.length) return
    const ids = new Set(list.map(conn => conn?.id).filter(Boolean))
    const current = chatSettings?.connectionId
    if (current && ids.has(current)) return
    const fallback = findConnection(settings, current)?.id || list[0]?.id || null
    if (fallback && fallback !== current) {
      chatSettings = { ...chatSettings, connectionId: fallback }
    }
  })

  $effect(() => {
    const chatId = props.chatId
    if (!chatId) return
    if (chatId !== lastReportedChatId) {
      lastReportedChatId = chatId
      lastReportedSending = null
    }
    const current = !!sending
    if (current === lastReportedSending) return
    lastReportedSending = current
    try { props.onGeneratingChange?.(chatId, current) } catch {}
  })

  let lastSettingsVersion = 0
  $effect(() => {
    const v = Number(props.settingsVersion) || 0
    if (v === lastSettingsVersion) return
    lastSettingsVersion = v
    try {
      const next = loadSettings()
      const changed = (
        settings?.apiKey !== next.apiKey ||
        presetSignature(settings) !== presetSignature(next) ||
        settings?.selectedPresetId !== next?.selectedPresetId ||
        settings?.selectedConnectionId !== next?.selectedConnectionId ||
        !!settings?.debug !== !!next?.debug
      )
      if (changed) {
        settings = next
        debug = !!next?.debug
      }
    } catch {}
  })

  $effect(() => {
    const cid = props.chatId
    if (!cid || !ready || !mounted) return
    try {
      const sig = computePersistSig(nodes, chatSettings, rootId)
      if (sig === persistSig) return
      persistSig = sig
      const p = saveChatContent(cid, { nodes, settings: chatSettings, rootId })
      p.then(updated => scheduleParentRefresh(updated)).catch(() => {})
    } catch {}
  })

  $effect(() => {
    if (chatSettingsOpen) {
      try { modelIds = loadModelsCache(chatSettings?.connectionId).ids || [] } catch {}
    }
  })

  onMount(async () => {
    mounted = true
    try {
      const connectionId = chatSettings?.connectionId
      const cached = loadModelsCache(connectionId)
      if (!cached.ids?.length) {
        const fresh = await ensureModels({ connectionId })
        setTimeout(() => {
          if (chatSettings?.connectionId === connectionId) {
            modelIds = fresh.ids || []
          }
        }, 0)
      } else {
        setTimeout(() => {
          if (chatSettings?.connectionId === connectionId) {
            modelIds = cached.ids || []
          }
        }, 0)
      }
    } catch {}
  })

  onDestroy(() => {
    const chatId = props.chatId
    if (!chatId) return
    try { props.onGeneratingChange?.(chatId, false) } catch {}
  })
</script>

<section class="chat-shell">
  <MessageList
    bind:this={listCmp}
    items={buildVisible()}
    chatId={props.chatId}
    notice={visibleNotice}
    total={nodes.length}
    locked={locked}
    debug={debug}
    editingId={editingId}
    editingText={editingText}
    followingMap={computeFollowingMap(nodes, rootId)}
    onDismissNotice={dismissNotice}
    onSetRole={(id, role) => handleSetMessageRole(id, role)}
    onEditInput={(t) => onEditableInput(t)}
    onEditKeydown={onEditableKeydown}
    onApplyEditSend={applyEditSend}
    onApplyEditBranch={applyBranch}
    onApplyEditReplace={applyEditReplace}
    onCancelEdit={cancelEdit}
    onChangeVariant={(id, d) => handleChangeVariant(id, d)}
    onRefreshAssistant={(id) => refreshAssistant(id)}
    onRefreshAfterUserIndex={(i) => refreshAfterUserIndex(i)}
    onCopy={(text) => copyMessage(text)}
    onDelete={(id) => handleDeleteMessage(id)}
    onEdit={(id) => editMessage(id)}
    onMoveDown={(id) => handleMoveDown(id)}
    onMoveUp={(id) => handleMoveUp(id)}
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
    chatReasoningSummary={chatSettings.reasoningSummary}
    chatTextVerbosity={chatSettings.textVerbosity}
    modelIds={modelIds}
    connections={connectionOptions}
    chatConnectionId={chatSettings.connectionId}
    onToggleChatSettings={toggleChatSettings}
    onCloseChatSettings={() => (chatSettingsOpen = false)}
    onChangeConnection={(val) => (chatSettings = { ...chatSettings, connectionId: (typeof val === 'string' && val.trim()) ? val.trim() : null })}
    onChangeModel={(val) => (chatSettings = { ...chatSettings, model: val })}
    onChangeStreaming={(val) => (chatSettings = { ...chatSettings, streaming: !!val })}
    onChangeMaxOutputTokens={(val) => (chatSettings = { ...chatSettings, maxOutputTokens: toIntOrNull(val) })}
    onChangeTopP={(val) => (chatSettings = { ...chatSettings, topP: toClampedNumber(val, 0, 1) })}
    onChangeTemperature={(val) => (chatSettings = { ...chatSettings, temperature: toClampedNumber(val, 0, 2) })}
    onChangeReasoningEffort={(val) => (chatSettings = { ...chatSettings, reasoningEffort: normalizeReasoning(val) })}
    onChangeReasoningSummary={(val) => (chatSettings = { ...chatSettings, reasoningSummary: normalizeReasoningSummary(val) })}
    onChangeTextVerbosity={(val) => (chatSettings = { ...chatSettings, textVerbosity: normalizeVerbosity(val) })}
    onInput={(val) => (input = val)}
    onAdd={(role) => addToChat(role)}
    onStop={() => stopGeneration()}
    onSend={(role) => sendWithRole(role)}
  />
</section>

<style>
  .chat-shell {
    --bg: color-mix(in oklab, canvas, #f3f4f6 10%);
    --panel: color-mix(in srgb, #ffffff 92%, #e6e6e6);
    --border: color-mix(in srgb, #c8c8c8 60%, #0000);
    --text: color-mix(in srgb, #1b1f24 92%, #0000);
    --muted: #6b7280;
    --accent: #3584e4;
    --assistant: #f3f4f6;
    --user: #e5e7eb;
    --page-gutter: clamp(14px, 4vw, 32px);
    --page-max: 980px;
    --float-shadow: 0 10px 30px rgba(0,0,0,0.08), 0 2px 10px rgba(0,0,0,0.06);
    --float-border: color-mix(in srgb, var(--border), transparent 55%);
    --bubble-pad-x: 12px;
    --actions-inset-x: clamp(0px, calc(var(--bubble-pad-x) - 4px), 100vw);
  }

  @media (prefers-color-scheme: dark) {
    .chat-shell {
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
</style>