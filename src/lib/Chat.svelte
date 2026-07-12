<script lang="ts">
  // Core imports
  import { onMount, onDestroy } from 'svelte'
  import { findConnection } from './settingsStore'
  import { settingsStore, generationRegistry } from './stores/appState.svelte'
  import { ensureModels, loadModelsCache } from './modelsStore'
  import { debugSetChatLockState } from './chatsStore'
  import { copyText as copyToClipboard } from './utils/clipboard'
  import MessageList from './components/chat/MessageList.svelte'
  import Composer from './components/chat/Composer.svelte'
  import ConfirmModal from './components/ConfirmModal.svelte'
  import { ChatImageManager } from './chat/imageManager.svelte'

  // Chat module imports
  import { loadChat } from './chat/services/chatLoader'
  import { pickPresetFromSettings, presetSignature } from './chat/services/chatInit'
  import { getCharacter } from './tavern/charactersStore'
  import { buildPromptInjections, resolvePromptPreset } from './tavern/promptPresets'
  import { resolveTavernPresetId } from './tavern/tavernPreset'
  import type { Character } from './types/tavern'
  import { createChatPersister } from './chat/services/chatPersistence'
  import { computeValidationNotice, computeGenerationNotice, assembleNotice, computeFollowingMap } from './chat/services/noticeHelpers'
  import { resolveConnectionContext as _resolveConnectionContext } from './chat/services/connectionResolver'
  import { createNoticeManager } from './chat/services/noticeManager'
  import { createGenerationStateManager } from './chat/services/generationStateManager'
  import { createEditStateManager } from './chat/services/editStateManager'
  import { validateChatEdit } from './chat/services/chatEditGuard'
  import { applyDebugLockToNodes, clearDebugLockFromNodes } from './chat/services/debugLock'

  // Action imports
  import { deleteMessage, setMessageRole, moveUp, moveDown } from './chat/actions/messageActions'
  import { changeVariant, updateVariantById } from './chat/actions/variantActions'
  import { commitEditReplace, applyEditBranch, prepareBranchAndSend, insertMessageBetween } from './chat/actions/editActions'
  import {
    prepareUserMessage,
    prepareTypingNode,
    generateResponse,
    handleGenerationSuccess,
    handleGenerationError,
    prepareRefreshAssistant,
    prepareRefreshAfterUser,
    validateTypingVariantVisible,
    logGenerationEvent
  } from './chat/actions/generationActions'

  // Utilities
  import { toIntOrNull, toClampedNumber } from './utils/numbers'
  import { deepClone } from './utils/immutable'
  import { normalizeReasoning, normalizeVerbosity, normalizeReasoningSummary } from './utils/validation'
  import { NO_API_KEY_NOTICE_TEXT } from './constants/index'
  import { buildVisible as _buildVisible, buildVisibleUpTo as _buildVisibleUpTo } from './branching'
  import { findNodeByMessageId } from './utils/treeUtils'
  import type { Node, Message, Chat as StoredChat, ChatSettings, AppSettings, ImageRef, Image, MessageRole, VisibleMessage } from './types'

  interface Props {
    chatId: string
    onNewChat?: (options?: { presetId?: string }) => void
    onChatUpdated?: (updated?: StoredChat) => void
  }

  const props: Props = $props()

  // Managers
  const noticeManager = createNoticeManager()
  const generationState = createGenerationStateManager()
  const editStateManager = createEditStateManager()

  // State
  let nodes = $state<Node[]>([])
  let rootId = $state<number | null>(1)
  let input = $state('')
  let sending = $state(false)
  let forcedLock = $state(false)
  let locked = $state(false)

  // Track the chatId that started the current generation to avoid race conditions
  let generationChatId: string | null = null

  // Synchronously update the registry when sending changes to avoid race conditions with unmounting
  function setSending(value: boolean, forChatId?: string) {
    sending = value
    // Use the provided chatId, or fall back to the generation chatId, or current props
    const chatId = forChatId ?? generationChatId ?? props.chatId
    if (chatId) {
      try { generationRegistry.setGenerating(chatId, value) } catch {}
    }
    // Clear generation chatId when stopping
    if (!value) {
      generationChatId = null
    }
  }

  // Start tracking a generation for a specific chatId
  function startSending() {
    generationChatId = props.chatId
    setSending(true, generationChatId)
  }
  let nextId = $state(1)
  let nextNodeId = $state(1)
  let ready = false
  let mounted = false
  let destroyed = false

  // Settings & chat configuration (single reactive source of truth)
  const initialSettings = settingsStore.current
  let settings = $state<AppSettings>(initialSettings)
  let debug = $state(!!initialSettings?.debug)

  // Sync settings from the store when it changes
  $effect(() => {
    const next = settingsStore.current
    if (next) {
      settings = next
      debug = !!next.debug
    }
  })
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

  let chatSettings = $state<ChatSettings>({
    model: initialPreset.model,
    streaming: initialPreset.streaming,
    presetId: initialPreset.id,
    maxOutputTokens: initialPreset.maxOutputTokens,
    topP: initialPreset.topP,
    temperature: initialPreset.temperature,
    reasoningEffort: initialPreset.reasoningEffort,
    textVerbosity: initialPreset.textVerbosity,
    reasoningSummary: initialPreset.reasoningSummary,
    thinkingEnabled: initialPreset.thinkingEnabled,
    thinkingBudgetTokens: initialPreset.thinkingBudgetTokens,
    connectionId: initialConnectionId,
    mcpEnabled: !!initialPreset.mcpEnabled,
    mcpServers: initialPreset.mcpServers || [],
  })

  let chatSettingsOpen = $state(false)
  let modelIds = $state<string[]>(loadModelsCache(initialConnectionId).ids || [])

  // Tavern: character bound to this chat (null for normal chats)
  let characterId = $state<string | null>(null)
  let character = $state<Character | null>(null)

  // Persistence: signature tracking, throttling and retries live in the persister.
  const persister = createChatPersister({
    getChatId: () => props.chatId || null,
    getState: () => ({ nodes, chatSettings, rootId, debug }),
    canPersist: () => {
      const cid = props.chatId
      return !!cid && mounted && loadedChatId === cid
    },
    isDestroyed: () => destroyed,
    isBusy: () => {
      if (sending) return true
      return Array.isArray(nodes) && nodes.some(n => (n?.variants || []).some(v => v?.typing))
    },
    onSanitized: (result) => {
      sanitizerNotice = result.notice
      if (result.nodes !== nodes) nodes = result.nodes
      if (result.rootId !== rootId) rootId = result.rootId
    },
    onChatUpdated: (updated) => {
      try { props.onChatUpdated?.(updated ?? undefined) } catch {}
    },
    onConflict: () => {
      sanitizerNotice = `Failed to save: this chat was modified in another tab. Reload the page to sync.`
    },
    onSaveError: (msg) => {
      sanitizerNotice = msg ? `Failed to save chat: ${msg}` : 'Failed to save chat.'
    },
  })

  // Editing state
  let editingId = $state<number | null>(null)
  let editingText = $state('')
  let insertedMessageId = $state<number | null>(null)

  // Delete confirmation state (session-only, resets on page refresh)
  let skipDeleteConfirm = $state(false)
  let deleteModalOpen = $state(false)
  let deleteModalMessageId = $state<number | null>(null)

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
        .map(conn => ({ id: conn.id, name: conn.name || conn.id, apiMode: conn.apiMode }))
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
    const result = _resolveConnectionContext(settings, chatSettings?.connectionId)
    settings = result.latestSettings
    return result
  }

  function showMissingApiKeyNotice() {
    const result = noticeManager.showMissingApiKeyNotice(dismissedNotice)
    dismissedNotice = result.dismissed
    missingApiKeyNotice = result.missingApiKey
  }

  function clearMissingApiKeyNotice() {
    const result = noticeManager.clearMissingApiKeyNotice()
    missingApiKeyNotice = result.missingApiKey
  }

  function dismissNotice() {
    dismissedNotice = noticeManager.dismissNotice(assembledNotice)
  }

  function updateVariant(variantId, transform) {
    nodes = updateVariantById(nodes, variantId, transform)
  }

  type ChatDraft = { nodes: Node[]; rootId: number | null; nextId: number; nextNodeId: number }

  function applyChatMutation(
    label: string,
    mutate: (draft: ChatDraft) => ChatDraft,
    options: { allowDelete?: boolean; requireVisibleVariantIds?: number[] | (() => number[]) } = {}
  ): boolean {
    const before: ChatDraft = {
      nodes: deepClone(nodes),
      rootId,
      nextId,
      nextNodeId,
    }

    let after: ChatDraft
    try {
      after = mutate({ nodes, rootId, nextId, nextNodeId })
    } catch (err) {
      sanitizerNotice = `Reverted ${label}: unexpected error during edit.`
      return false
    }

    const guard = validateChatEdit(before, after, {
      label,
      allowDelete: options.allowDelete,
      debug,
      requireVisibleVariantIds: options.requireVisibleVariantIds,
    })

    if (!guard.ok) {
      nodes = before.nodes
      rootId = before.rootId
      nextId = before.nextId
      nextNodeId = before.nextNodeId
      if (guard.notice) sanitizerNotice = guard.notice
      return false
    }

    nodes = after.nodes
    rootId = after.rootId
    nextId = after.nextId
    nextNodeId = after.nextNodeId
    return true
  }

  // Generation state management
  function resetGenerationState() {
    generationState.reset()
  }

  function registerAbortHandler(sequence: number, fn: (() => void) | null) {
    generationState.registerAbortHandler(sequence, fn)
  }

  function finishGeneration() {
    setSending(false)
    resetGenerationState()
  }

  function finalizeGeneration(sequence: number): boolean {
    const isCurrentGen = generationState.getGenerationSequence() === sequence
    if (isCurrentGen) {
      generationState.completeGeneration(sequence)
    }
    if (!(isCurrentGen || !generationState.isGenerationActive())) {
      return false
    }
    finishGeneration()
    logGenerationEvent(debug, 'Generation finished', { sequence, wasCurrentGen: isCurrentGen })
    return true
  }

  async function toggleDebugLock() {
    if (!debug) return
    const chatId = props.chatId
    if (!forcedLock) {
      forcedLock = true
      nodes = applyDebugLockToNodes(nodes)
      try {
        await persistNow()
      } catch {}
      if (chatId) {
        try { await debugSetChatLockState(chatId, true) } catch {}
      }
      return
    }

    nodes = clearDebugLockFromNodes(nodes)
    forcedLock = false
    try {
      await persistNow()
    } catch {}
    if (chatId) {
      try { await debugSetChatLockState(chatId, false) } catch {}
    }
  }

  // Persistence (policy lives in createChatPersister)
  async function persistNow() {
    await persister.persistNow()
  }

  // Scroll helper
  let listCmp: { scrollToBottom?: () => void } | undefined
  function scrollToBottom(): void {
    try { listCmp?.scrollToBottom?.() } catch {}
  }

  // Attachments & image cache (see chat/imageManager.svelte.ts)
  const images = new ChatImageManager()
  const handleFilesSelected = (files) => images.handleFilesSelected(files)
  const removeAttachedImage = (id) => images.removeAttachedImage(id)
  const storeGeneratedImagesInMedia = (reply) => images.storeGeneratedImagesInMedia(reply)
  const sanitizeNodesImageData = (nodesInput) => images.sanitizeNodesImageData(nodesInput)
  const withImageData = (nodesInput) => images.withImageData(nodesInput)

  let imageLoadTimer: ReturnType<typeof setTimeout> | null = null
  $effect(() => {
    const visible = buildVisible()

    // Debounce image loading to reduce frequent effect runs
    if (imageLoadTimer) clearTimeout(imageLoadTimer)
    imageLoadTimer = setTimeout(() => {
      images.ensureVisibleImages(visible)
    }, 100) // Debounce for 100ms

    return () => {
      if (imageLoadTimer) {
        clearTimeout(imageLoadTimer)
        imageLoadTimer = null
      }
    }
  })

  const visibleMessages = $derived(buildVisible())

  // Message actions
  async function copyMessage(text) {
    try { await copyToClipboard(text) } catch {}
  }

  function requestDeleteMessage(messageId: number) {
    if (locked) return
    if (skipDeleteConfirm) {
      executeDeleteMessage(messageId)
      return
    }
    deleteModalMessageId = messageId
    deleteModalOpen = true
  }

  function executeDeleteMessage(messageId: number) {
    const ok = applyChatMutation(
      `delete message ${messageId}`,
      (draft) => {
        const result = deleteMessage(draft.nodes, draft.rootId, messageId)
        return { ...draft, nodes: result.nodes, rootId: result.rootId }
      },
      { allowDelete: true }
    )
    if (ok) persistNow()
  }

  function confirmDeleteMessage() {
    if (deleteModalMessageId != null) {
      executeDeleteMessage(deleteModalMessageId)
    }
    deleteModalOpen = false
    deleteModalMessageId = null
  }

  function cancelDeleteMessage() {
    deleteModalOpen = false
    deleteModalMessageId = null
  }

  function handleSetMessageRole(id, role) {
    if (locked) return
    const ok = applyChatMutation(`set role ${id}`, (draft) => ({
      ...draft,
      nodes: setMessageRole(draft.nodes, id, role),
    }))
    if (ok) persistNow()
  }

  function handleMoveUp(messageId) {
    if (locked) return
    const ok = applyChatMutation(
      `move up ${messageId}`,
      (draft) => {
        const result = moveUp(draft.nodes, draft.rootId, messageId)
        return { ...draft, nodes: result.nodes, rootId: result.rootId }
      },
      { requireVisibleVariantIds: [messageId] }
    )
    if (ok) persistNow()
  }

  function handleMoveDown(messageId) {
    if (locked) return
    const ok = applyChatMutation(
      `move down ${messageId}`,
      (draft) => {
        const result = moveDown(draft.nodes, draft.rootId, messageId)
        return { ...draft, nodes: result.nodes, rootId: result.rootId }
      },
      { requireVisibleVariantIds: [messageId] }
    )
    if (ok) persistNow()
  }

  function handleChangeVariant(id, delta) {
    if (locked) return
    const ok = applyChatMutation(`change variant ${id}`, (draft) => ({
      ...draft,
      nodes: changeVariant(draft.nodes, id, delta),
    }))
    if (ok) persistNow()
  }

  function debugMessageDeath(messageId) {
    if (!debug) return
    if (locked) return
    applyChatMutation(
      `message death ${messageId}`,
      (draft) => {
        const result = deleteMessage(draft.nodes, draft.rootId, messageId)
        return { ...draft, nodes: result.nodes, rootId: result.rootId }
      }
    )
  }

  // Edit actions
  function normalizeEditableText(raw) {
    if (typeof raw !== 'string') return ''
    return raw.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
  }

  function onEditableInput(eOrText) {
    if (editingId == null) return
    try {
      const next = typeof eOrText === 'string'
        ? eOrText
        : eOrText?.currentTarget?.innerText
      if (typeof next === 'string') {
        const normalized = normalizeEditableText(next)
        editStateManager.updateText(normalized)
        editingText = normalized
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
    const loc = findNodeByMessageId(nodes, id)
    const msg = loc?.node?.variants?.[loc.index]
    if (!msg || msg.typing) return

    // Use edit state manager to prevent switching edits
    const text = msg.content || ''
    if (!editStateManager.startEdit(id, text)) {
      // Already editing another message, blocked
      return
    }

    editingId = id
    editingText = text
  }

  function commitEdit() {
    if (locked) return
    if (editingId == null) return
    const id = editingId
    const text = editingText
    const ok = applyChatMutation(`edit message ${id}`, (draft) => ({
      ...draft,
      nodes: commitEditReplace(draft.nodes, id, text),
    }))
    if (!ok) return
    editStateManager.finishEdit(true)
    editingId = null
    editingText = ''
    persistNow()
  }

  function applyEditReplace() { commitEdit() }

  function applyBranch() {
    if (locked) return
    if (editingId == null) return
    const id = editingId
    const text = editingText
    const ok = applyChatMutation(`branch from ${id}`, (draft) => {
      const result = applyEditBranch(draft.nodes, id, text, draft.nextId)
      return { ...draft, nodes: result.nodes, nextId: result.nextId }
    })
    if (!ok) return
    editStateManager.finishEdit(true)
    editingId = null
    editingText = ''
    persistNow()
  }

  async function applyEditSend() {
    if (locked) return
    if (editingId == null) return
    if (generationState.isGenerationActive()) {
      logGenerationEvent(debug, 'Blocked applyEditSend: generation already active')
      return
    }

    const prepared = prepareBranchAndSend(nodes, rootId, editingId, editingText, nextId, nextNodeId)
    if (!prepared) {
      logGenerationEvent(debug, 'Failed to prepare branch and send')
      return
    }

    if (prepared.shouldRefreshOnly) {
      editStateManager.finishEdit(true)
      editingId = null
      editingText = ''
      await refreshAfterUserIndex(prepared.insertIndex)
      return
    }

    const { connectionId, apiKey } = resolveConnectionContext()
    if (!apiKey) {
      showMissingApiKeyNotice()
      // Still apply the edit as a branch, but do not create a typing node.
      const id = editingId
      const text = editingText
      const ok = applyChatMutation(`edit+send (branch only) ${id}`, (draft) => {
        const result = applyEditBranch(draft.nodes, id, text, draft.nextId)
        return { ...draft, nodes: result.nodes, nextId: result.nextId }
      })
      if (ok) {
        editStateManager.finishEdit(true)
        editingId = null
        editingText = ''
        persistNow()
      }
      return
    }
    clearMissingApiKeyNotice()

    const typingVariantId = prepared.typingVariantId
    const ok = applyChatMutation(
      `edit+send ${editingId}`,
      (draft) => ({
        ...draft,
        nodes: prepared.nodes,
        nextId: prepared.nextId,
        nextNodeId: prepared.nextNodeId,
      }),
      { requireVisibleVariantIds: () => (typingVariantId != null ? [typingVariantId] : []) }
    )
    if (!ok) return

    editStateManager.finishEdit(true)
    editingId = null
    editingText = ''

    // Extra guard: should already be guaranteed by the mutation validator above.
    if (!validateTypingVariantVisible(nodes, rootId, typingVariantId)) {
      logGenerationEvent(debug, 'Typing node not visible in applyEditSend', { typingVariantId })
      nodes = handleGenerationError(nodes, typingVariantId, new Error('Typing node not visible'))
      persistNow()
      return
    }

    resetGenerationState()
    const genSeq = generationState.startGeneration()
    logGenerationEvent(debug, 'Starting applyEditSend', { sequence: genSeq, typingVariantId })

    startSending()
    generationState.setTypingVariantId(typingVariantId)
    persistNow()

    await runGeneration(typingVariantId, genSeq, connectionId)
  }

  function cancelEdit() {
    editStateManager.finishEdit(false)
    editingId = null
    editingText = ''
    insertedMessageId = null
  }

  function forkMessage(id) {
    if (locked) return
    const loc = findNodeByMessageId(nodes, id)
    const msg = loc?.node?.variants?.[loc.index]
    if (!msg || msg.typing) return
    const ok = applyChatMutation(`fork ${id}`, (draft) => {
      const result = applyEditBranch(draft.nodes, id, msg.content || '', draft.nextId)
      return { ...draft, nodes: result.nodes, nextId: result.nextId }
    })
    if (ok) persistNow()
  }

  function handleInsertBetween(afterIndex) {
    if (locked) return

    // Block insert if already editing another message
    if (editStateManager.isEditing()) {
      return
    }

    const result = insertMessageBetween(nodes, rootId, afterIndex, nextId, nextNodeId)
    if (!result) return
    const ok = applyChatMutation(`insert between ${afterIndex}`, (draft) => ({
      ...draft,
      nodes: result.nodes,
      nextId: result.nextId,
      nextNodeId: result.nextNodeId,
    }))
    if (!ok) return

    // Start editing the new empty message using edit state manager
    if (!editStateManager.startEdit(result.insertedMessageId, '')) {
      return
    }
    editingId = result.insertedMessageId
    editingText = ''
    insertedMessageId = result.insertedMessageId
    persistNow()
  }

  function deleteInsertedMessage() {
    if (insertedMessageId == null) return
    const idToDelete = insertedMessageId
    cancelEdit()
    insertedMessageId = null
    const ok = applyChatMutation(
      `delete inserted ${idToDelete}`,
      (draft) => {
        const result = deleteMessage(draft.nodes, draft.rootId, idToDelete)
        return { ...draft, nodes: result.nodes, rootId: result.rootId }
      },
      { allowDelete: true }
    )
    if (ok) persistNow()
  }

  // Send message
  // Shared generation lifecycle: streams a response into the typing variant,
  // stores generated media, applies success/error to the graph and persists.
  async function runGeneration(
    typingVariantId: number,
    genSeq: number,
    connectionId: string | null,
    logContext: Record<string, unknown> = {}
  ) {
    let generationFinalized = false
    try {
      let summaryBuffer = ''
      const requestNodes = withImageData(nodes)
      logGenerationEvent(debug, 'Starting API request', { typingVariantId, ...logContext })
      // Tavern: inject prompt preset blocks around the history for character chats
      const injections = (characterId && character)
        ? buildPromptInjections(
            resolvePromptPreset(settings?.promptPresets, settings?.selectedPromptPresetId),
            character,
            settings?.persona || null
          )
        : null
      const reply = await generateResponse({
        nodes: requestNodes,
        rootId,
        chatSettings,
        connectionId,
        streaming: chatSettings.streaming,
        historyPrefix: injections?.prefix,
        historySuffix: injections?.suffix,
        typingVariantId,
        onAbort: (fn) => registerAbortHandler(genSeq, fn),
        onTextDelta: (full) => {
          if (generationState.getGenerationSequence() === genSeq) {
            updateVariant(typingVariantId, (prev) => ({ ...prev, content: full }))
          }
        },
        onReasoningSummaryDelta: (fullSummary) => {
          if (generationState.getGenerationSequence() === genSeq && typeof fullSummary === 'string') {
            summaryBuffer = fullSummary
            updateVariant(typingVariantId, (prev) => ({
              ...prev,
              reasoningSummary: summaryBuffer,
              reasoningSummaryLoading: true,
            }))
          }
        },
        onReasoningSummaryDone: (fullSummary) => {
          if (generationState.getGenerationSequence() === genSeq && typeof fullSummary === 'string') {
            summaryBuffer = fullSummary
            updateVariant(typingVariantId, (prev) => ({
              ...prev,
              reasoningSummary: summaryBuffer,
              reasoningSummaryLoading: false,
            }))
          }
        },
      })
      logGenerationEvent(debug, 'API request completed', { typingVariantId, ...logContext })

      if (generationState.getGenerationSequence() === genSeq) {
        const storedReply = await storeGeneratedImagesInMedia(reply)
        // Re-check after the await: Stop may have been pressed while storing images.
        if (generationState.getGenerationSequence() === genSeq) {
          nodes = handleGenerationSuccess(nodes, typingVariantId, storedReply, summaryBuffer)
        }
      }
      generationFinalized = finalizeGeneration(genSeq)
      await persistNow()
    } catch (err) {
      logGenerationEvent(debug, 'Generation error', { error: err?.message, typingVariantId, ...logContext })
      if (generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationError(nodes, typingVariantId, err)
      }
      generationFinalized = finalizeGeneration(genSeq)
      await persistNow()
    } finally {
      if (!generationFinalized) finalizeGeneration(genSeq)
    }
  }

  async function sendWithRole(role = 'user') {
    if (locked || sending) return

    const rawInput = (typeof input === 'string') ? input : ''
    const trimmedInput = rawInput.trim()
    const imageRefs = images.buildAttachedImageRefs()
    const hasContent = trimmedInput.length > 0
    const hasImages = imageRefs.length > 0

    if (role !== 'user' && !hasContent && !hasImages) {
      input = ''
      images.clearAttached()
      return
    }

    if (generationState.isGenerationActive()) {
      logGenerationEvent(debug, 'Blocked send: generation already active')
      return
    }

    const resolved = resolveConnectionContext()
    const connectionId = resolved.connectionId
    const apiKey = resolved.apiKey
    if (apiKey) clearMissingApiKeyNotice()
    else showMissingApiKeyNotice()

    // Nothing to send + no API key to generate with => just show notice.
    if (!apiKey && role === 'user' && !hasContent && !hasImages) return

    let typingVariantId: number | null = null
    let newNodeId: number | null = null
    const ok = applyChatMutation(
      `send ${role}`,
      (draft) => {
        let nextDraft = draft

        if (role === 'user') {
          if (hasContent || hasImages) {
            const prepared = prepareUserMessage(
              nextDraft.nodes,
              nextDraft.rootId,
              trimmedInput,
              nextDraft.nextId,
              nextDraft.nextNodeId,
              imageRefs
            )
            if (!prepared) throw new Error('Failed to prepare user message')
            newNodeId = prepared.newNodeId
            nextDraft = {
              ...nextDraft,
              nodes: prepared.nodes,
              rootId: prepared.rootId,
              nextId: prepared.nextId,
              nextNodeId: prepared.nextNodeId,
            }
          }
        } else {
          const finalRole = (typeof role === 'string' && role.trim()) ? role.trim() : 'user'
          const text = typeof rawInput === 'string' ? rawInput : ''
          const normalizedImages = Array.isArray(imageRefs) ? imageRefs.filter(Boolean) : []

          const variant = {
            id: nextDraft.nextId,
            role: finalRole,
            content: text,
            time: Date.now(),
            typing: false,
            error: undefined,
            next: null,
            images: normalizedImages.length ? normalizedImages : undefined,
          }

          const node = { id: nextDraft.nextNodeId, variants: [variant], active: 0 }
          const visible = _buildVisible(nextDraft.nodes, nextDraft.rootId)
          const lastVm = visible.at(-1)

          let arr = nextDraft.nodes.slice()
          arr.push(node)
          let nextRootId = nextDraft.rootId
          if (lastVm) {
            arr = arr.map(n => (n.id === lastVm.nodeId
              ? (() => {
                  const activeIndex = Math.max(0, Math.min((n.variants?.length || 1) - 1, Number(n.active) || 0))
                  return { ...n, variants: n.variants.map((v, i) => (i === activeIndex ? { ...v, next: node.id } : v)) }
                })()
              : n))
          } else {
            nextRootId = node.id
          }

          newNodeId = node.id
          nextDraft = {
            ...nextDraft,
            nodes: arr,
            rootId: nextRootId,
            nextId: nextDraft.nextId + 1,
            nextNodeId: nextDraft.nextNodeId + 1,
          }
        }

        if (apiKey) {
          const parentNodeId = (() => {
            if (role === 'user') {
              if (hasContent || hasImages) return newNodeId
              const lastVm = _buildVisible(nextDraft.nodes, nextDraft.rootId).at(-1)
              return lastVm ? lastVm.nodeId : null
            }
            return newNodeId
          })()

          const prepared = prepareTypingNode(nextDraft.nodes, nextDraft.rootId, parentNodeId, nextDraft.nextId, nextDraft.nextNodeId)
          typingVariantId = prepared.typingVariantId
          nextDraft = {
            ...nextDraft,
            nodes: prepared.nodes,
            rootId: prepared.rootId,
            nextId: prepared.nextId,
            nextNodeId: prepared.nextNodeId,
          }
        }

        return nextDraft
      },
      { requireVisibleVariantIds: () => (typingVariantId != null ? [typingVariantId] : []) }
    )
    if (!ok) return

    input = ''
    images.clearAttached()

    let genSeq: number | null = null
    if (apiKey && typingVariantId != null) {
      // Extra guard: should already be guaranteed by the mutation validator above.
      if (!validateTypingVariantVisible(nodes, rootId, typingVariantId)) {
        logGenerationEvent(debug, 'Typing node not visible', { typingVariantId, role })
        nodes = handleGenerationError(nodes, typingVariantId, new Error('Typing node not visible'))
        persistNow()
        return
      }

      resetGenerationState()
      genSeq = generationState.startGeneration()
      logGenerationEvent(debug, 'Starting send', { sequence: genSeq, role })

      startSending()
      generationState.setTypingVariantId(typingVariantId)
      logGenerationEvent(debug, 'Typing node prepared', { typingVariantId, role })
    }

    persistNow()
    queueMicrotask(() => scrollToBottom())

    if (!(apiKey && typingVariantId != null && genSeq != null)) return

    await runGeneration(typingVariantId, genSeq, connectionId, { role })
  }

  function send() { return sendWithRole('user') }

  function stopGeneration() {
    if (!sending) return
    const typingId = generationState.getTypingVariantId()
    generationState.forceStopGeneration()
    if (typingId != null) {
      updateVariant(typingId, (prev) => ({
        ...prev,
        typing: false,
        error: undefined,
        reasoningSummaryLoading: false,
        content: (prev.content === 'typing' ? '' : prev.content),
      }))
    }
    setSending(false)
    persistNow()
  }

  function appendMessage(role, content, imageRefs, options = {}) {
    const { persist = true } = options
    const finalRole = (typeof role === 'string' && role.trim()) ? role.trim() : 'user'
    const text = typeof content === 'string' ? content : ''
    const normalizedImages = Array.isArray(imageRefs) ? imageRefs.filter(Boolean) : []

    let newNodeId: number | null = null
    const ok = applyChatMutation(`append ${finalRole}`, (draft) => {
      const variant = {
        id: draft.nextId,
        role: finalRole,
        content: text,
        time: Date.now(),
        typing: false,
        error: undefined,
        next: null,
        images: normalizedImages.length ? normalizedImages : undefined,
      }

      const node = { id: draft.nextNodeId, variants: [variant], active: 0 }
      newNodeId = node.id

      const visible = _buildVisible(draft.nodes, draft.rootId)
      const lastVm = visible.at(-1)

      let arr = draft.nodes.slice()
      arr.push(node)
      let nextRootId = draft.rootId
      if (lastVm) {
        arr = arr.map(n => (n.id === lastVm.nodeId
          ? (() => {
              const activeIndex = Math.max(0, Math.min((n.variants?.length || 1) - 1, Number(n.active) || 0))
              return { ...n, variants: n.variants.map((v, i) => (i === activeIndex ? { ...v, next: node.id } : v)) }
            })()
          : n))
      } else {
        nextRootId = node.id
      }

      return {
        ...draft,
        nodes: arr,
        rootId: nextRootId,
        nextId: draft.nextId + 1,
        nextNodeId: draft.nextNodeId + 1,
      }
    })

    if (!ok || newNodeId == null) return null
    if (persist) persistNow()
    return newNodeId
  }

  function addToChat(role = 'user') {
    if (locked) return
    const text = (typeof input === 'string') ? input : ''
    const imageRefs = images.buildAttachedImageRefs()
    const hasImages = imageRefs.length > 0
    const inserted = appendMessage(role, text, hasImages ? imageRefs : [])
    if (inserted == null) return
    input = ''
    images.clearAttached()
    queueMicrotask(() => scrollToBottom())
  }

  // Refresh actions
  async function refreshAssistant(id) {
    if (locked) return
    if (generationState.isGenerationActive()) {
      logGenerationEvent(debug, 'Blocked refreshAssistant: generation already active')
      return
    }

    const { connectionId, apiKey } = resolveConnectionContext()
    if (!apiKey) {
      showMissingApiKeyNotice()
      return
    }
    clearMissingApiKeyNotice()

    const prepared = prepareRefreshAssistant(nodes, rootId, id, nextId)
    if (!prepared) {
      logGenerationEvent(debug, 'Failed to prepare refresh assistant')
      return
    }

    const typingVariantId = prepared.typingVariantId
    const ok = applyChatMutation(
      `refresh assistant ${id}`,
      (draft) => ({
        ...draft,
        nodes: prepared.nodes,
        nextId: prepared.nextId,
      }),
      { requireVisibleVariantIds: () => [typingVariantId] }
    )
    if (!ok) return

    resetGenerationState()
    const genSeq = generationState.startGeneration()
    logGenerationEvent(debug, 'Starting refreshAssistant', { sequence: genSeq, typingVariantId })
    startSending()
    generationState.setTypingVariantId(typingVariantId)
    persistNow()

    await runGeneration(typingVariantId, genSeq, connectionId)
  }

  async function refreshAfterUserIndex(i) {
    if (locked) return
    if (generationState.isGenerationActive()) {
      logGenerationEvent(debug, 'Blocked refreshAfterUserIndex: generation already active')
      return
    }

    const { connectionId, apiKey } = resolveConnectionContext()
    if (!apiKey) {
      showMissingApiKeyNotice()
      return
    }
    clearMissingApiKeyNotice()

    const prepared = prepareRefreshAfterUser(nodes, rootId, i, nextId, nextNodeId)
    if (!prepared) {
      logGenerationEvent(debug, 'Failed to prepare refresh after user')
      return
    }

    const typingVariantId = prepared.typingVariantId
    const ok = applyChatMutation(
      `refresh after user ${i}`,
      (draft) => ({
        ...draft,
        nodes: prepared.nodes,
        nextId: prepared.nextId,
        nextNodeId: prepared.nextNodeId,
      }),
      { requireVisibleVariantIds: () => [typingVariantId] }
    )
    if (!ok) return

    resetGenerationState()
    const genSeq = generationState.startGeneration()
    logGenerationEvent(debug, 'Starting refreshAfterUserIndex', { sequence: genSeq, index: i, typingVariantId })
    startSending()
    generationState.setTypingVariantId(typingVariantId)
    persistNow()

    await runGeneration(typingVariantId, genSeq, connectionId)
  }

  // Debug function - intentionally named to indicate it deliberately breaks branching logic
  // Creates duplicate branches for testing edge cases and branch corruption scenarios
  function debugFuckUpBranch(id) {
    if (locked) return
    const loc = findNodeByMessageId(nodes, id)
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

  // Tavern quick preset edit: chat settings changes in a character chat write
  // straight back to the tavern-selected preset, so the settings popover acts
  // as a quick preset editor instead of per-chat overrides.
  function persistTavernPresetPatch(patch: Record<string, unknown>) {
    if (!characterId) return
    try {
      const current = settingsStore.current
      // Per-chat preset mode: chat settings are per-chat overrides, exactly
      // like chat mode — never write back into the preset.
      if (current?.tavernPerChatPresets) return
      const targetId = resolveTavernPresetId(current)
      if (!targetId) return
      const list = Array.isArray(current?.presets) ? current.presets : []
      if (!list.some(p => p?.id === targetId)) return
      const nextPresets = list.map(p => (p?.id === targetId ? { ...p, ...patch } : p))
      appliedTavernPresetSig = JSON.stringify(nextPresets.find(p => p?.id === targetId))
      settingsStore.save({ ...current, presets: nextPresets })
    } catch {}
  }

  function updateChatSettings(patch: Partial<ChatSettings>) {
    chatSettings = { ...chatSettings, ...patch }
    persistTavernPresetPatch(patch as Record<string, unknown>)
  }

  function handleSelectPreset(preset) {
    if (!preset || typeof preset !== 'object') return
    // Apply preset settings (excluding systemPrompt)
    chatSettings = {
      ...chatSettings,
      model: preset.model || chatSettings.model,
      streaming: typeof preset.streaming === 'boolean' ? preset.streaming : chatSettings.streaming,
      maxOutputTokens: preset.maxOutputTokens ?? chatSettings.maxOutputTokens,
      topP: preset.topP ?? chatSettings.topP,
      temperature: preset.temperature ?? chatSettings.temperature,
      reasoningEffort: preset.reasoningEffort || chatSettings.reasoningEffort,
      textVerbosity: preset.textVerbosity || chatSettings.textVerbosity,
      reasoningSummary: preset.reasoningSummary || chatSettings.reasoningSummary,
      thinkingEnabled: typeof preset.thinkingEnabled === 'boolean' ? preset.thinkingEnabled : chatSettings.thinkingEnabled,
      thinkingBudgetTokens: preset.thinkingBudgetTokens ?? chatSettings.thinkingBudgetTokens,
      connectionId: preset.connectionId || chatSettings.connectionId,
      presetId: preset.id || chatSettings.presetId,
      // Web Search settings
      webSearchEnabled: typeof preset.webSearchEnabled === 'boolean' ? preset.webSearchEnabled : chatSettings.webSearchEnabled,
      webSearchDomains: preset.webSearchDomains ?? chatSettings.webSearchDomains,
      webSearchCountry: preset.webSearchCountry ?? chatSettings.webSearchCountry,
      webSearchCity: preset.webSearchCity ?? chatSettings.webSearchCity,
      webSearchRegion: preset.webSearchRegion ?? chatSettings.webSearchRegion,
      webSearchTimezone: preset.webSearchTimezone ?? chatSettings.webSearchTimezone,
      webSearchCacheOnly: typeof preset.webSearchCacheOnly === 'boolean' ? preset.webSearchCacheOnly : chatSettings.webSearchCacheOnly,
      // Code Interpreter settings
      codeInterpreterEnabled: typeof preset.codeInterpreterEnabled === 'boolean' ? preset.codeInterpreterEnabled : chatSettings.codeInterpreterEnabled,
      codeInterpreterNetworkEnabled: typeof preset.codeInterpreterNetworkEnabled === 'boolean' ? preset.codeInterpreterNetworkEnabled : chatSettings.codeInterpreterNetworkEnabled,
      codeInterpreterAllowedDomains: preset.codeInterpreterAllowedDomains ?? chatSettings.codeInterpreterAllowedDomains,
      // Shell settings
      shellEnabled: typeof preset.shellEnabled === 'boolean' ? preset.shellEnabled : chatSettings.shellEnabled,
      shellNetworkEnabled: typeof preset.shellNetworkEnabled === 'boolean' ? preset.shellNetworkEnabled : chatSettings.shellNetworkEnabled,
      shellAllowedDomains: preset.shellAllowedDomains ?? chatSettings.shellAllowedDomains,
      // Image Generation settings
      imageGenerationEnabled: typeof preset.imageGenerationEnabled === 'boolean' ? preset.imageGenerationEnabled : chatSettings.imageGenerationEnabled,
      imageGenerationModel: preset.imageGenerationModel ?? chatSettings.imageGenerationModel,
      // MCP settings
      mcpEnabled: typeof preset.mcpEnabled === 'boolean' ? preset.mcpEnabled : chatSettings.mcpEnabled,
      mcpServers: preset.mcpServers ?? chatSettings.mcpServers,
    }
    // Tavern: picking a preset from the composer switches the tavern-wide
    // selection — unless per-chat presets are enabled, in which case the pick
    // only affects this chat (same as chat mode).
    if (characterId && preset.id) {
      try {
        const current = settingsStore.current
        if (!current?.tavernPerChatPresets && resolveTavernPresetId(current) !== preset.id) {
          settingsStore.save({ ...current, tavernSelectedPresetId: preset.id })
        }
      } catch {}
    }
    persistNow()
  }

  // Lifecycle effects
  let loadedChatId: string | null = null
  $effect(() => {
    const cid = props.chatId

    // Skip if we've already loaded this chat
    if (loadedChatId === cid) return

    ready = false
    forcedLock = false
    persister.reset()
    chatSettingsOpen = false

    if (!cid) return

    loadChat(cid).then((result) => {
      // Skip if we switched to a different chat while loading, or user started editing
      if (props.chatId !== cid || editingId !== null) {
        ready = true
        return
      }
      try {
        settings = result.settings
        const sanitizedNodes = sanitizeNodesImageData(result.nodes)
        nodes = sanitizedNodes
        nextId = result.nextId
        nextNodeId = result.nextNodeId
        chatSettings = result.chatSettings
        characterId = result.characterId || null
        character = null
        if (result.characterId) {
          const charId = result.characterId
          getCharacter(charId).then((loadedChar) => {
            if (props.chatId === cid && characterId === charId) {
              character = loadedChar
            }
          }).catch(() => {})
        }
        try { modelIds = loadModelsCache(result.chatSettings?.connectionId).ids || [] } catch {}
        rootId = result.rootId
	        editStateManager.forceClear()
	        editingId = null
	        editingText = ''
	        dismissedNotice = ''
	        persister.markPersisted(result.persistSig)
	        loadedChatId = cid
	      } finally {
	        ready = true
	      }
    }).catch(() => {
      ready = true
    })
  })

  $effect(() => {
    try {
      const autoLocked = !!(sending || (Array.isArray(nodes) && nodes.some(n => (n?.variants || []).some(v => v?.typing))))
      locked = !!(forcedLock || autoLocked)
    } catch { locked = !!(forcedLock || sending) }
  })

  // Tavern: character chats follow the tavern preset selection. Re-apply when
  // the selection or the preset's contents change (e.g. via tavern settings).
  let appliedTavernPresetSig = ''
  $effect(() => {
    if (!characterId) return
    const current = settingsStore.current
    // Per-chat preset mode: chats keep their own settings, no auto-follow.
    if (current?.tavernPerChatPresets) return
    const selectedId = resolveTavernPresetId(current)
    if (!selectedId) return
    const preset = (current?.presets || []).find(p => p?.id === selectedId)
    if (!preset) return
    const sig = JSON.stringify(preset)
    if (chatSettings?.presetId === selectedId && sig === appliedTavernPresetSig) return
    appliedTavernPresetSig = sig
    handleSelectPreset(preset)
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
    if (!debug && forcedLock) {
      nodes = clearDebugLockFromNodes(nodes)
      forcedLock = false
      const chatId = props.chatId
      Promise.resolve().then(async () => {
        try { await persistNow() } catch {}
        if (chatId) {
          try { await debugSetChatLockState(chatId, false) } catch {}
        }
      }).catch(() => {})
    }
  })

	  $effect(() => {
	    const cid = props.chatId
	    if (!cid || !ready || !mounted) return
	    if (loadedChatId !== cid) return
	    const hasTyping = Array.isArray(nodes) && nodes.some(n => (n?.variants || []).some(v => v?.typing))
	    if (sending || hasTyping) return
	    // The persister dedupes via content signatures; computing the signature
	    // deep-reads nodes/chatSettings/rootId so this effect tracks content changes.
	    persister.requestPersist()
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
    destroyed = true
    mounted = false
    const chatId = props.chatId
    // Abort any in-flight generation to prevent orphaned HTTP requests
    if (generationState.isGenerationActive()) {
      generationState.forceStopGeneration()
    }
    if (!chatId) return
    try { generationRegistry.setGenerating(chatId, false) } catch {}
    persister.cancel()

    // Best-effort: flush any pending throttled persists for this chat.
    // Guard against persisting uninitialized state when a chat unmounts before load completes.
    try {
      if (ready && loadedChatId === chatId) {
        persister.flushForUnmount(chatId, {
          nodes: deepClone(nodes),
          chatSettings: { ...chatSettings },
          rootId,
          debug,
        })
      }
    } catch {}
  })
</script>

<section class="chat-shell">
  <MessageList
    bind:this={listCmp}
    items={visibleMessages}
    character={characterId ? character : null}
    personaName={settings?.persona?.name}
    avatarShape={settings?.tavernAvatarShape}
    imageCache={images.imageCache}
    chatId={props.chatId}
    notice={visibleNotice}
    total={nodes.length}
    locked={locked}
    debug={debug}
    editingId={editingId}
    editingText={editingText}
    insertedMessageId={insertedMessageId}
    allowInlineHtml={settings?.allowInlineHtml}
    renderLatex={settings?.renderLatex !== false}
    messageActions={settings?.messageActions}
    editorActions={settings?.editorActions}
    disableRoleSwitching={settings?.disableRoleSwitching}
    showInsertButtons={settings?.showInsertButtons !== false}
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
    onDelete={(id) => requestDeleteMessage(id)}
    onEdit={(id) => editMessage(id)}
    onMoveDown={(id) => handleMoveDown(id)}
    onMoveUp={(id) => handleMoveUp(id)}
    onFork={(id) => forkMessage(id)}
    onDeleteInserted={deleteInsertedMessage}
    onDebugFuckBranch={(id) => debugFuckUpBranch(id)}
    onDebugMessageDeath={(id) => debugMessageDeath(id)}
    onInsertBetween={(afterIndex) => handleInsertBetween(afterIndex)}
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
    chatThinkingEnabled={chatSettings.thinkingEnabled}
    chatThinkingBudgetTokens={chatSettings.thinkingBudgetTokens}
    chatWebSearchEnabled={chatSettings.webSearchEnabled}
    chatCodeInterpreterEnabled={chatSettings.codeInterpreterEnabled}
    chatCodeInterpreterNetworkEnabled={chatSettings.codeInterpreterNetworkEnabled}
    chatCodeInterpreterAllowedDomains={chatSettings.codeInterpreterAllowedDomains}
    chatShellEnabled={chatSettings.shellEnabled}
    chatShellNetworkEnabled={chatSettings.shellNetworkEnabled}
    chatShellAllowedDomains={chatSettings.shellAllowedDomains}
    chatImageGenerationEnabled={chatSettings.imageGenerationEnabled}
    chatImageGenerationModel={chatSettings.imageGenerationModel}
    chatMcpEnabled={chatSettings.mcpEnabled}
    chatMcpServers={chatSettings.mcpServers}
    modelIds={modelIds}
    connections={connectionOptions}
    chatConnectionId={chatSettings.connectionId}
    attachedImages={images.attachedImages}
    keybinds={settings?.keybinds}
    showThinkingControls={!!settings?.showThinkingSettings}
    presets={characterId ? settings?.presets : (settings?.presets || []).filter(p => !p?.tavernOnly)}
    onToggleChatSettings={toggleChatSettings}
    onCloseChatSettings={() => (chatSettingsOpen = false)}
    onChangeConnection={(val) => {
      const newConnectionId = (typeof val === 'string' && val.trim()) ? val.trim() : null
      const newConnection = connectionOptions.find(c => c.id === newConnectionId)
      // Clear responses-API-only features when switching to non-responses API connection
      if (newConnection?.apiMode !== 'responses') {
        updateChatSettings({
          connectionId: newConnectionId,
          webSearchEnabled: false,
          codeInterpreterEnabled: false,
          shellEnabled: false,
          imageGenerationEnabled: false,
          mcpEnabled: false,
        })
      } else {
        updateChatSettings({ connectionId: newConnectionId })
      }
    }}
    onChangeModel={(val) => updateChatSettings({ model: val })}
    onChangeStreaming={(val) => updateChatSettings({ streaming: !!val })}
    onChangeMaxOutputTokens={(val) => updateChatSettings({ maxOutputTokens: toIntOrNull(val) })}
    onChangeTopP={(val) => updateChatSettings({ topP: toClampedNumber(val, 0, 1) })}
    onChangeTemperature={(val) => updateChatSettings({ temperature: toClampedNumber(val, 0, 2) })}
    onChangeReasoningEffort={(val) => updateChatSettings({ reasoningEffort: normalizeReasoning(val) })}
    onChangeReasoningSummary={(val) => updateChatSettings({ reasoningSummary: normalizeReasoningSummary(val) })}
    onChangeTextVerbosity={(val) => updateChatSettings({ textVerbosity: normalizeVerbosity(val) })}
    onChangeThinkingEnabled={(val) => updateChatSettings({ thinkingEnabled: !!val })}
    onChangeThinkingBudgetTokens={(val) => updateChatSettings({ thinkingBudgetTokens: toIntOrNull(val) })}
    onChangeWebSearchEnabled={(val) => updateChatSettings({ webSearchEnabled: !!val })}
    onChangeCodeInterpreterEnabled={(val) => updateChatSettings({ codeInterpreterEnabled: !!val })}
    onChangeCodeInterpreterNetworkEnabled={(val) => updateChatSettings({ codeInterpreterNetworkEnabled: !!val })}
    onChangeCodeInterpreterAllowedDomains={(val) => updateChatSettings({ codeInterpreterAllowedDomains: val || undefined })}
    onChangeShellEnabled={(val) => updateChatSettings({ shellEnabled: !!val })}
    onChangeShellNetworkEnabled={(val) => updateChatSettings({ shellNetworkEnabled: !!val })}
    onChangeShellAllowedDomains={(val) => updateChatSettings({ shellAllowedDomains: val || undefined })}
    onChangeImageGenerationEnabled={(val) => updateChatSettings({ imageGenerationEnabled: !!val })}
    onChangeImageGenerationModel={(val) => updateChatSettings({ imageGenerationModel: val || undefined })}
    onChangeMcpEnabled={(val) => updateChatSettings({ mcpEnabled: !!val })}
    onChangeMcpServers={(servers) => updateChatSettings({ mcpServers: servers })}
    onSelectPreset={handleSelectPreset}
    disableSendRolePopup={settings?.disableSendRolePopup}
    showAddWithoutSend={settings?.showAddWithoutSend}
    onInput={(val) => (input = val)}
    onAdd={(role) => addToChat(role)}
    onStop={() => stopGeneration()}
    onSend={(role) => sendWithRole(role)}
    onFilesSelected={handleFilesSelected}
    onRemoveImage={removeAttachedImage}
  />
  {#if debug}
    <button
      type="button"
      class="hidden-debug-lock"
      onclick={toggleDebugLock}
      aria-label={forcedLock ? 'Clear simulated lock' : 'Simulate persisted lock leak'}
      aria-pressed={forcedLock ? 'true' : 'false'}
      title={forcedLock ? 'Clear simulated lock' : 'Simulate persisted lock leak'}
    ></button>
  {/if}

  <ConfirmModal
    open={deleteModalOpen}
    title="Delete message"
    message="Are you sure you want to delete this message?"
    confirmText="Delete"
    cancelText="Cancel"
    danger={true}
    checkbox={true}
    checkboxLabel="Don't ask again this session"
    checkboxChecked={skipDeleteConfirm}
    onCheckboxChange={(checked) => (skipDeleteConfirm = checked)}
    onConfirm={confirmDeleteMessage}
    onCancel={cancelDeleteMessage}
  />
</section>

<style>
  .chat-shell {
    position: relative;
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

  :global(:root[data-theme='dark']) .chat-shell {
    --panel: #141414;
    --border: #2a2a2a;
    --text: #e6e6e6;
    --muted: #a3a3a3;
    --assistant: #1c1c1c;
    --user: #222222;
  }

  .hidden-debug-lock {
    position: absolute;
    bottom: 6px;
    right: 6px;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent), transparent 35%);
    opacity: 0.75;
    box-shadow: 0 1px 3px rgba(0,0,0,0.18);
    cursor: pointer;
  }

  .hidden-debug-lock:focus-visible,
  .hidden-debug-lock:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--accent), transparent 20%);
  }

  .hidden-debug-lock[aria-pressed='true'] {
    opacity: 1;
    background: color-mix(in srgb, var(--accent), transparent 10%);
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
