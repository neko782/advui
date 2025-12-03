<script lang="ts">
  // Core imports
  import { onMount, onDestroy } from 'svelte'
  import { loadSettings, findConnection } from './settingsStore'
  import { ensureModels, loadModelsCache } from './modelsStore'
  import { saveChatContent, debugSetChatLockState } from './chatsStore'
  import { copyText as copyToClipboard } from './utils/clipboard'
  import MessageList from './components/chat/MessageList.svelte'
  import Composer from './components/chat/Composer.svelte'
  import { storeImage, generateImageId, fileToBase64, getImage } from './imageStore'

  // Chat module imports
  import { loadChat } from './chat/services/chatLoader'
  import { pickPresetFromSettings, presetSignature } from './chat/services/chatInit'
  import { persistChatContent, computePersistSig } from './chat/services/chatPersistence'
  import { computeValidationNotice, computeGenerationNotice, assembleNotice, computeFollowingMap } from './chat/services/noticeHelpers'
  import { resolveConnectionContext as _resolveConnectionContext } from './chat/services/connectionResolver'
  import { createPersistenceScheduler } from './chat/services/persistenceScheduler'
  import { createNoticeManager } from './chat/services/noticeManager'
  import { createGenerationStateManager } from './chat/services/generationStateManager'

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
  import { normalizeReasoning, normalizeVerbosity, normalizeReasoningSummary } from './utils/validation'
  import { NO_API_KEY_NOTICE_TEXT } from './constants/index'
  import { buildVisible as _buildVisible, buildVisibleUpTo as _buildVisibleUpTo } from './branching'
  import { findNodeByMessageId } from './utils/treeUtils'
  import type { Node, Message, ChatSettings, AppSettings, ImageRef, Image, MessageRole, VisibleMessage } from './types'

  interface Props {
    chatId: string
    onNewChat?: (options?: { presetId?: string }) => void
    onChatUpdated?: () => void
    settingsVersion?: number
    onGeneratingChange?: (chatId: string, isGenerating: boolean) => void
  }

  const props: Props = $props()

  // Managers
  const persistenceScheduler = createPersistenceScheduler()
  const noticeManager = createNoticeManager()
  const generationState = createGenerationStateManager()

  // State
  let nodes = $state<Node[]>([])
  let rootId = $state<number | null>(1)
  let input = $state('')
  let attachedImages = $state<Image[]>([])
  let imageCache = $state<Record<string, { data: string; mimeType?: string; name?: string }>>({})
  let sending = $state(false)
  let forcedLock = $state(false)
  let locked = $state(false)
  let nextId = $state(1)
  let nextNodeId = $state(1)
  let ready = false
  let mounted = false
  let lastChatId: string | null = null
  let lastReportedChatId: string | null = null
  let lastReportedSending: boolean | null = null

  // Settings & chat configuration
  const initialSettings = loadSettings()
  let settings = $state<AppSettings>(initialSettings)
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
  })

  let chatSettingsOpen = $state(false)
  let modelIds = $state<string[]>(loadModelsCache(initialConnectionId).ids || [])
  let persistSig = ''

  // Editing state
  let editingId = $state<number | null>(null)
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

  // Generation state management
  function resetGenerationState() {
    generationState.reset()
  }

  function registerAbortHandler(fn) {
    generationState.registerAbortHandler(fn)
  }

  function finishGeneration() {
    sending = false
    resetGenerationState()
  }

  function applyDebugLockToVariants(list) {
    if (!Array.isArray(list)) return list
    return list.map((variant) => {
      if (!variant || typeof variant !== 'object') return variant
      return {
        ...variant,
        locked: true,
        typing: true,
      }
    })
  }

  function applyDebugLockToNodes(list) {
    if (!Array.isArray(list)) return list
    return list.map((node) => {
      if (!node || typeof node !== 'object') return node
      return {
        ...node,
        locked: true,
        variants: applyDebugLockToVariants(node.variants),
      }
    })
  }

  function clearDebugLockFromVariants(list) {
    if (!Array.isArray(list)) return list
    return list.map((variant) => {
      if (!variant || typeof variant !== 'object') return variant
      let next = variant
      let mutated = false
      if (next.locked) {
        if (!mutated) next = { ...next }
        delete next.locked
        mutated = true
      }
      if (next.typing) {
        if (!mutated) next = { ...next }
        next.typing = false
        mutated = true
      }
      return mutated ? next : variant
    })
  }

  function clearDebugLockFromNodes(list) {
    if (!Array.isArray(list)) return list
    return list.map((node) => {
      if (!node || typeof node !== 'object') return node
      let next = node
      let mutated = false
      if (next.locked) {
        next = { ...next }
        delete next.locked
        mutated = true
      }
      const variants = clearDebugLockFromVariants(next.variants)
      if (variants !== next.variants) {
        if (!mutated) next = { ...next }
        next.variants = variants
        mutated = true
      }
      return mutated ? next : node
    })
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

  function scheduleParentRefresh(updated) {
    persistenceScheduler.scheduleRefresh(props.onChatUpdated, updated)
  }

  // Scroll helper
  let listCmp: { scrollToBottom?: () => void } | undefined
  function scrollToBottom(): void {
    try { listCmp?.scrollToBottom?.() } catch {}
  }

  // Attachment handling
  function isSupportedAttachment(file) {
    if (!file) return false
    const type = typeof file.type === 'string' ? file.type : ''
    if (type.startsWith('image/')) return true
    if (type === 'application/pdf') return true
    if (!type && typeof file.name === 'string') {
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.pdf')) return true
      if (/\.(png|jpe?g|gif|webp)$/i.test(lower)) return true
    }
    if (type === 'application/octet-stream' && typeof file.name === 'string') {
      return file.name.toLowerCase().endsWith('.pdf')
    }
    return false
  }

  function inferMimeType(file) {
    if (!file) return ''
    if (typeof file.type === 'string' && file.type) return file.type
    if (typeof file.name === 'string' && file.name) {
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.png')) return 'image/png'
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
      if (lower.endsWith('.gif')) return 'image/gif'
      if (lower.endsWith('.webp')) return 'image/webp'
      if (lower.endsWith('.pdf')) return 'application/pdf'
    }
    return ''
  }

  async function handleFilesSelected(files) {
    try {
      const incoming = Array.isArray(files) ? files : []
      const accepted = incoming.filter(isSupportedAttachment)
      if (!accepted.length) return
      const imagePromises = accepted.map(async (file) => {
        const id = generateImageId()
        const base64 = await fileToBase64(file)
        const mimeType = inferMimeType(file) || file.type || ''
        await storeImage(id, base64, mimeType, file.name)
        const image = {
          id,
          data: base64,
          mimeType: mimeType || undefined,
          name: file?.name || undefined
        }
        cacheImageData(image)
        return image
      })
      const images = await Promise.all(imagePromises)
      attachedImages = [...attachedImages, ...images]
    } catch (err) {
      console.error('Failed to attach images:', err)
    }
  }

  function removeAttachedImage(id) {
    attachedImages = attachedImages.filter(img => img.id !== id)
  }

  function toImageRef(img) {
    if (!img || typeof img !== 'object') return null
    const id = typeof img.id === 'string' && img.id.trim() ? img.id.trim() : null
    if (!id) return null
    const ref = { id }
    if (typeof img.mimeType === 'string' && img.mimeType.trim()) ref.mimeType = img.mimeType.trim()
    if (typeof img.name === 'string' && img.name.trim()) ref.name = img.name.trim()
    return ref
  }

  function buildImageRefs(list) {
    if (!Array.isArray(list)) return []
    const refs = []
    const seen = new Set()
    for (const img of list) {
      const ref = toImageRef(img)
      if (!ref || seen.has(ref.id)) continue
      seen.add(ref.id)
      refs.push(ref)
    }
    return refs
  }

  function cacheImageData(image) {
    if (!image || typeof image !== 'object') return
    const id = typeof image.id === 'string' && image.id.trim() ? image.id.trim() : null
    const data = typeof image.data === 'string' && image.data ? image.data : null
    if (!id || !data) return
    const mimeType = typeof image.mimeType === 'string' && image.mimeType.trim() ? image.mimeType.trim() : undefined
    const name = typeof image.name === 'string' && image.name.trim() ? image.name.trim() : undefined
    const existing = imageCache[id] || {}
    const next = {
      data,
      mimeType: mimeType || existing.mimeType,
      name: name || existing.name,
    }
    if (existing.data === next.data && existing.mimeType === next.mimeType && existing.name === next.name) return
    imageCache = { ...imageCache, [id]: next }
  }

  const pendingImageLoads = new Set()

  async function fetchImageRecord(meta) {
    const id = typeof meta?.id === 'string' && meta.id.trim() ? meta.id.trim() : null
    if (!id) return
    if (pendingImageLoads.has(id)) return
    if (imageCache[id]?.data) return
    if (typeof indexedDB === 'undefined') return
    pendingImageLoads.add(id)
    try {
      const record = await getImage(id)
      if (record && typeof record.data === 'string' && record.data) {
        cacheImageData({
          id,
          data: record.data,
          mimeType: record.mimeType || meta?.mimeType,
          name: record.name || meta?.name,
        })
      }
    } catch {}
    finally {
      pendingImageLoads.delete(id)
    }
  }

  function ensureImagesAvailable(list) {
    if (!Array.isArray(list) || !list.length) return
    const tasks = []
    for (const meta of list) {
      const id = typeof meta?.id === 'string' && meta.id.trim() ? meta.id.trim() : null
      if (!id) continue
      if (imageCache[id]?.data) continue
      tasks.push(fetchImageRecord(meta))
    }
    if (tasks.length) Promise.allSettled(tasks).catch(() => {})
  }

  function resolveImagesForMessage(images) {
    const refs = buildImageRefs(images)
    if (!refs.length) return []
    return refs.map(ref => {
      const cached = imageCache[ref.id]
      if (cached?.data) {
        return {
          ...ref,
          data: cached.data,
          mimeType: ref.mimeType || cached.mimeType,
          name: ref.name ?? cached.name,
        }
      }
      return ref
    })
  }

  function sanitizeNodesImageData(nodesInput) {
    if (!Array.isArray(nodesInput)) return nodesInput
    let mutated = false
    const sanitizedNodes = nodesInput.map(node => {
      if (!node || typeof node !== 'object') return node
      const variants = Array.isArray(node.variants) ? node.variants : []
      let variantsChanged = false
      const sanitizedVariants = variants.map(variant => {
        if (!variant || typeof variant !== 'object') return variant
        const refs = buildImageRefs(variant.images)
        const hasImages = refs.length > 0
        const originalImages = Array.isArray(variant.images) ? variant.images : []
        let needsUpdate = hasImages
          ? (originalImages.length !== refs.length)
          : originalImages.length > 0
        if (!needsUpdate && hasImages) {
          for (let i = 0; i < refs.length; i++) {
            const orig = originalImages[i]
            const ref = refs[i]
            if (typeof orig === 'string') { needsUpdate = true; break }
            if (!orig || typeof orig !== 'object') { needsUpdate = true; break }
            const origMime = (typeof orig.mimeType === 'string' && orig.mimeType.trim()) || ''
            const origName = (typeof orig.name === 'string' && orig.name.trim()) || ''
            const refMime = ref.mimeType || ''
            const refName = ref.name || ''
            const hasData = typeof orig.data === 'string' && orig.data
            if (orig.id !== ref.id || origMime !== refMime || origName !== refName || hasData) {
              needsUpdate = true
              break
            }
          }
        }
        if (!needsUpdate) return variant

        variantsChanged = true
        if (hasImages) {
          for (const orig of originalImages) {
            if (orig && typeof orig === 'object' && typeof orig.data === 'string' && orig.data) {
              cacheImageData(orig)
            }
          }
          return { ...variant, images: refs }
        }

        for (const orig of originalImages) {
          if (orig && typeof orig === 'object' && typeof orig.data === 'string' && orig.data) {
            cacheImageData(orig)
          }
        }
        const cleaned = { ...variant }
        delete cleaned.images
        return cleaned
      })
      if (!variantsChanged) return node
      mutated = true
      return { ...node, variants: sanitizedVariants }
    })
    return mutated ? sanitizedNodes : nodesInput
  }

  let imageLoadTimer: ReturnType<typeof setTimeout> | null = null
  $effect(() => {
    const visible = buildVisible()

    // Debounce image loading to reduce frequent effect runs
    if (imageLoadTimer) clearTimeout(imageLoadTimer)
    imageLoadTimer = setTimeout(() => {
      const missing = []
      const seen = new Set()
      for (const vm of visible) {
        const imgs = Array.isArray(vm?.m?.images) ? vm.m.images : []
        for (const img of imgs) {
          if (img == null) continue
          if (typeof img === 'string') {
            const id = img.trim()
            if (!id || imageCache[id]?.data || seen.has(id)) continue
            seen.add(id)
            missing.push({ id })
            continue
          }
          if (typeof img !== 'object') continue
          if (typeof img.data === 'string' && img.data) {
            cacheImageData(img)
            continue
          }
          const id = typeof img.id === 'string' && img.id.trim() ? img.id.trim() : null
          if (!id || imageCache[id]?.data || seen.has(id)) continue
          seen.add(id)
          missing.push({ id, mimeType: img.mimeType, name: img.name })
        }
      }
      if (missing.length) ensureImagesAvailable(missing)
    }, 100) // Debounce for 100ms
  })

  const visibleMessages = $derived((() => {
    const base = buildVisible()
    return base.map(vm => {
      const msg = vm.m
      if (!msg) return vm
      if (!Array.isArray(msg.images) || !msg.images.length) return vm
      const resolved = resolveImagesForMessage(msg.images)
      return { ...vm, m: { ...msg, images: resolved } }
    })
  })())

  function withImageData(nodesInput) {
    if (!Array.isArray(nodesInput)) return nodesInput
    let mutated = false
    const enrichedNodes = nodesInput.map(node => {
      if (!node || typeof node !== 'object') return node
      const variants = Array.isArray(node.variants) ? node.variants : []
      let variantsChanged = false
      const enrichedVariants = variants.map(variant => {
        if (!variant || typeof variant !== 'object') return variant
        const images = Array.isArray(variant.images) ? variant.images : []
        if (!images.length) return variant
        let changed = false
        const enrichedImages = images.map(image => {
          if (image == null) return image
          if (typeof image === 'string') {
            const id = image.trim()
            if (!id) return image
            const cached = imageCache[id]
            if (cached?.data) {
              changed = true
              return {
                id,
                mimeType: cached.mimeType,
                name: cached.name,
                data: cached.data,
              }
            }
            return { id }
          }
          if (typeof image !== 'object') return image
          if (typeof image.data === 'string' && image.data) return image
          const id = typeof image.id === 'string' && image.id.trim() ? image.id.trim() : null
          if (!id) return image
          const cached = imageCache[id]
          if (cached?.data) {
            changed = true
            return {
              ...image,
              data: cached.data,
              mimeType: image.mimeType || cached.mimeType,
              name: image.name ?? cached.name,
            }
          }
          return image
        })
        if (!changed) return variant
        variantsChanged = true
        return { ...variant, images: enrichedImages }
      })
      if (!variantsChanged) return node
      mutated = true
      return { ...node, variants: enrichedVariants }
    })
    return mutated ? enrichedNodes : nodesInput
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
        editingText = normalizeEditableText(next)
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
    editingId = id
    editingText = msg.content || ''
  }

  function commitEdit() {
    if (locked) return
    if (editingId == null) return
    nodes = commitEditReplace(nodes, editingId, editingText)
    editingId = null
    editingText = ''
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
      editingId = null
      editingText = ''
      await refreshAfterUserIndex(prepared.insertIndex)
      return
    }

    const typingVariantId = prepared.typingVariantId
    nodes = prepared.nodes
    nextId = prepared.nextId
    nextNodeId = prepared.nextNodeId
    editingId = null
    editingText = ''

    // Validate typing node is visible before starting generation
    if (!validateTypingVariantVisible(nodes, rootId, typingVariantId)) {
      logGenerationEvent(debug, 'Typing node not visible in applyEditSend', { typingVariantId })
      nodes = handleGenerationError(nodes, typingVariantId, new Error('Typing node not visible'))
      persistNow()
      return
    }

    resetGenerationState()
    const genSeq = generationState.startGeneration()
    logGenerationEvent(debug, 'Starting applyEditSend', { sequence: genSeq, typingVariantId })

    const { connectionId, apiKey } = resolveConnectionContext()
    if (!apiKey) {
      persistNow()
      showMissingApiKeyNotice()
      generationState.completeGeneration(genSeq)
      return
    }
    clearMissingApiKeyNotice()

    sending = true
    generationState.setTypingVariantId(typingVariantId)
    persistNow()

    try {
      let summaryBuffer = ''
      const requestNodes = withImageData(nodes)
      logGenerationEvent(debug, 'Starting API request', { typingVariantId })
      const reply = await generateResponse({
        nodes: requestNodes,
        rootId,
        chatSettings,
        connectionId,
        streaming: chatSettings.streaming,
        typingVariantId,
        onAbort: registerAbortHandler,
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
      logGenerationEvent(debug, 'API request completed', { typingVariantId })
      if (generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationSuccess(nodes, typingVariantId, reply, summaryBuffer)
      }
      persistNow()
    } catch (err) {
      logGenerationEvent(debug, 'Generation error', { error: err?.message, typingVariantId })
      if (generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationError(nodes, typingVariantId, err)
      }
      persistNow()
    } finally {
      if (generationState.getGenerationSequence() === genSeq) {
        generationState.completeGeneration(genSeq)
        finishGeneration()
        logGenerationEvent(debug, 'Generation finished', { sequence: genSeq })
      }
    }
  }

  function cancelEdit() {
    editingId = null
    editingText = ''
  }

  function forkMessage(id) {
    if (locked) return
    const loc = findNodeByMessageId(nodes, id)
    const msg = loc?.node?.variants?.[loc.index]
    if (!msg || msg.typing) return
    const result = applyEditBranch(nodes, id, msg.content || '', nextId)
    nodes = result.nodes
    nextId = result.nextId
    persistNow()
  }

  function handleInsertBetween(afterIndex) {
    if (locked) return
    const result = insertMessageBetween(nodes, rootId, afterIndex, nextId, nextNodeId)
    if (!result) return
    nodes = result.nodes
    nextId = result.nextId
    nextNodeId = result.nextNodeId
    // Start editing the new empty message
    editingId = result.insertedMessageId
    editingText = ''
    persistNow()
  }

  // Send message
  async function sendWithRole(role = 'user') {
    if (locked || sending) return

    const rawInput = (typeof input === 'string') ? input : ''
    const trimmedInput = rawInput.trim()
    const imageRefs = buildImageRefs(attachedImages)
    const hasContent = trimmedInput.length > 0
    const hasImages = imageRefs.length > 0

    if (role !== 'user' && !hasContent && !hasImages) {
      input = ''
      attachedImages = []
      return
    }

    if (generationState.isGenerationActive()) {
      logGenerationEvent(debug, 'Blocked send: generation already active')
      return
    }

    resetGenerationState()
    const genSeq = generationState.startGeneration()
    logGenerationEvent(debug, 'Starting send', { sequence: genSeq, role })

    let connectionId = null
    let apiKey = ''
    let typingVariantId = null
    let newNodeId = null

    if (role === 'user') {
      if (hasContent || hasImages) {
        const prepared = prepareUserMessage(nodes, rootId, trimmedInput, nextId, nextNodeId, imageRefs)
        if (!prepared) {
          logGenerationEvent(debug, 'Failed to prepare user message')
          generationState.completeGeneration(genSeq)
          return
        }
        nodes = prepared.nodes
        rootId = prepared.rootId
        nextId = prepared.nextId
        nextNodeId = prepared.nextNodeId
        newNodeId = prepared.newNodeId
      }
    } else {
      newNodeId = appendMessage(role, rawInput, imageRefs, { persist: false })
    }

    input = ''
    attachedImages = []

    const resolved = resolveConnectionContext()
    connectionId = resolved.connectionId
    apiKey = resolved.apiKey
    if (apiKey) {
      clearMissingApiKeyNotice()
    } else {
      showMissingApiKeyNotice()
    }

    if (apiKey) {
      const parentNodeId = (() => {
        if (role === 'user') {
          if (hasContent || hasImages) return newNodeId
          const lastVm = buildVisible().at(-1)
          return lastVm ? lastVm.nodeId : null
        }
        return newNodeId
      })()

      const prepared = prepareTypingNode(nodes, rootId, parentNodeId, nextId, nextNodeId)
      if (!prepared) {
        logGenerationEvent(debug, 'Failed to prepare typing node', { role, parentNodeId })
        persistNow()
        generationState.completeGeneration(genSeq)
        return
      }
      nodes = prepared.nodes
      rootId = prepared.rootId
      typingVariantId = prepared.typingVariantId
      nextId = prepared.nextId
      nextNodeId = prepared.nextNodeId

      if (!validateTypingVariantVisible(nodes, rootId, typingVariantId)) {
        logGenerationEvent(debug, 'Typing node not visible', { typingVariantId, role })
        nodes = handleGenerationError(nodes, typingVariantId, new Error('Typing node not visible'))
        persistNow()
        generationState.completeGeneration(genSeq)
        return
      }

      sending = true
      generationState.setTypingVariantId(typingVariantId)
      logGenerationEvent(debug, 'Typing node prepared', { typingVariantId, role })
    }

    persistNow()
    queueMicrotask(() => scrollToBottom())

    try {
      let reply = null
      let summaryBuffer = ''
      if (apiKey && typingVariantId != null) {
        const requestNodes = withImageData(nodes)
        logGenerationEvent(debug, 'Starting API request', { typingVariantId, role })
        reply = await generateResponse({
          nodes: requestNodes,
          rootId,
          chatSettings,
          connectionId,
          streaming: chatSettings.streaming,
          typingVariantId,
          onAbort: registerAbortHandler,
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
        logGenerationEvent(debug, 'API request completed', { typingVariantId, role })
      }
      if (typingVariantId != null && generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationSuccess(nodes, typingVariantId, reply, summaryBuffer)
      }
      persistNow()
    } catch (err) {
      logGenerationEvent(debug, 'Generation error', { error: err?.message, typingVariantId, role })
      if (typingVariantId != null && generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationError(nodes, typingVariantId, err)
      }
      persistNow()
    } finally {
      if (generationState.getGenerationSequence() === genSeq) {
        generationState.completeGeneration(genSeq)
        finishGeneration()
        logGenerationEvent(debug, 'Generation finished', { sequence: genSeq })
      }
    }
  }

  function send() { return sendWithRole('user') }

  function stopGeneration() {
    if (!sending) return
    generationState.requestAbort()
    const typingId = generationState.getTypingVariantId()
    if (typingId != null) {
      updateVariant(typingId, (prev) => ({
        ...prev,
        typing: false,
        error: undefined,
        reasoningSummaryLoading: false,
        content: (prev.content === 'typing' ? '' : prev.content),
      }))
    }
    sending = false
    persistNow()
  }

  function appendMessage(role, content, imageRefs, options = {}) {
    const { persist = true } = options
    const finalRole = (typeof role === 'string' && role.trim()) ? role.trim() : 'user'
    const text = typeof content === 'string' ? content : ''
    const normalizedImages = Array.isArray(imageRefs) ? imageRefs.filter(Boolean) : []

    const variant = {
      id: nextId++,
      role: finalRole,
      content: text,
      time: Date.now(),
      typing: false,
      error: undefined,
      next: null,
      images: normalizedImages.length ? normalizedImages : undefined
    }

    const node = { id: nextNodeId++, variants: [variant], active: 0 }
    const visible = buildVisible()
    const lastVm = visible.at(-1)
    let arr = nodes.slice()
    arr.push(node)
    if (lastVm) {
      arr = arr.map(n => (n.id === lastVm.nodeId
        ? {
            ...n,
            variants: n.variants.map((v, i) => (i === (Number(n.active) || 0) ? { ...v, next: node.id } : v))
          }
        : n))
    } else {
      rootId = node.id
    }
    nodes = arr
    if (persist) {
      persistNow()
    }
    return node.id
  }

  function addToChat(role = 'user') {
    if (locked) return
    const text = (typeof input === 'string') ? input : ''
    const imageRefs = buildImageRefs(attachedImages)
    const hasImages = imageRefs.length > 0
    appendMessage(role, text, hasImages ? imageRefs : [])
    input = ''
    attachedImages = []
    queueMicrotask(() => scrollToBottom())
  }

  // Refresh actions
  async function refreshAssistant(id) {
    if (locked) return
    if (generationState.isGenerationActive()) {
      logGenerationEvent(debug, 'Blocked refreshAssistant: generation already active')
      return
    }

    const prepared = prepareRefreshAssistant(nodes, rootId, id, nextId)
    if (!prepared) {
      logGenerationEvent(debug, 'Failed to prepare refresh assistant')
      return
    }

    const typingVariantId = prepared.typingVariantId

    // Validate typing node is visible before starting generation
    if (!validateTypingVariantVisible(prepared.nodes, rootId, typingVariantId)) {
      logGenerationEvent(debug, 'Typing node not visible in refreshAssistant', { typingVariantId })
      nodes = prepared.nodes
      nextId = prepared.nextId
      nodes = handleGenerationError(nodes, typingVariantId, new Error('Typing node not visible'))
      persistNow()
      return
    }

    resetGenerationState()
    const genSeq = generationState.startGeneration()
    logGenerationEvent(debug, 'Starting refreshAssistant', { sequence: genSeq, typingVariantId })

    const { connectionId, apiKey } = resolveConnectionContext()
    if (!apiKey) {
      showMissingApiKeyNotice()
      generationState.completeGeneration(genSeq)
      return
    }
    clearMissingApiKeyNotice()

    nodes = prepared.nodes
    nextId = prepared.nextId
    sending = true
    generationState.setTypingVariantId(typingVariantId)
    persistNow()

    try {
      let summaryBuffer = ''
      const requestNodes = withImageData(nodes)
      logGenerationEvent(debug, 'Starting API request', { typingVariantId })
      const reply = await generateResponse({
        nodes: requestNodes,
        rootId,
        chatSettings,
        connectionId,
        streaming: chatSettings.streaming,
        typingVariantId,
        onAbort: registerAbortHandler,
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
      logGenerationEvent(debug, 'API request completed', { typingVariantId })
      if (generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationSuccess(nodes, typingVariantId, reply, summaryBuffer)
      }
      persistNow()
    } catch (err) {
      logGenerationEvent(debug, 'Generation error', { error: err?.message, typingVariantId })
      if (generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationError(nodes, typingVariantId, err)
      }
      persistNow()
    } finally {
      if (generationState.getGenerationSequence() === genSeq) {
        generationState.completeGeneration(genSeq)
        finishGeneration()
        logGenerationEvent(debug, 'Generation finished', { sequence: genSeq })
      }
    }
  }

  async function refreshAfterUserIndex(i) {
    if (locked) return
    if (generationState.isGenerationActive()) {
      logGenerationEvent(debug, 'Blocked refreshAfterUserIndex: generation already active')
      return
    }

    const prepared = prepareRefreshAfterUser(nodes, rootId, i, nextId, nextNodeId)
    if (!prepared) {
      logGenerationEvent(debug, 'Failed to prepare refresh after user')
      return
    }

    const typingVariantId = prepared.typingVariantId

    // Validate typing node is visible before starting generation
    if (!validateTypingVariantVisible(prepared.nodes, rootId, typingVariantId)) {
      logGenerationEvent(debug, 'Typing node not visible in refreshAfterUserIndex', { typingVariantId })
      nodes = prepared.nodes
      nextId = prepared.nextId
      nextNodeId = prepared.nextNodeId
      nodes = handleGenerationError(nodes, typingVariantId, new Error('Typing node not visible'))
      persistNow()
      return
    }

    resetGenerationState()
    const genSeq = generationState.startGeneration()
    logGenerationEvent(debug, 'Starting refreshAfterUserIndex', { sequence: genSeq, index: i, typingVariantId })

    const { connectionId, apiKey } = resolveConnectionContext()
    if (!apiKey) {
      showMissingApiKeyNotice()
      generationState.completeGeneration(genSeq)
      return
    }
    clearMissingApiKeyNotice()

    nodes = prepared.nodes
    nextId = prepared.nextId
    nextNodeId = prepared.nextNodeId
    sending = true
    generationState.setTypingVariantId(typingVariantId)
    persistNow()

    try {
      let summaryBuffer = ''
      const requestNodes = withImageData(nodes)
      logGenerationEvent(debug, 'Starting API request', { typingVariantId })
      const reply = await generateResponse({
        nodes: requestNodes,
        rootId,
        chatSettings,
        connectionId,
        streaming: chatSettings.streaming,
        typingVariantId,
        onAbort: registerAbortHandler,
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
      logGenerationEvent(debug, 'API request completed', { typingVariantId })
      if (generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationSuccess(nodes, typingVariantId, reply, summaryBuffer)
      }
      persistNow()
    } catch (err) {
      logGenerationEvent(debug, 'Generation error', { error: err?.message, typingVariantId })
      if (generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationError(nodes, typingVariantId, err)
      }
      persistNow()
    } finally {
      if (generationState.getGenerationSequence() === genSeq) {
        generationState.completeGeneration(genSeq)
        finishGeneration()
        logGenerationEvent(debug, 'Generation finished', { sequence: genSeq })
      }
    }
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
    }
    persistNow()
  }

  // Lifecycle effects
  $effect(() => {
    const cid = props.chatId
    if (lastChatId && lastChatId !== cid && mounted) {
      try { saveChatContent(lastChatId, { nodes, settings: chatSettings, rootId }) } catch {}
    }
    lastChatId = cid
    ready = false
    forcedLock = false
    persistSig = ''
    chatSettingsOpen = false
    
    if (!cid) return

    loadChat(cid).then((result) => {
      try {
        settings = result.settings
        const sanitizedNodes = sanitizeNodesImageData(result.nodes)
        nodes = sanitizedNodes
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
        !!settings?.debug !== !!next?.debug ||
        JSON.stringify(settings?.keybinds) !== JSON.stringify(next?.keybinds) ||
        !!settings?.showThinkingSettings !== !!next?.showThinkingSettings
      )
      if (changed) {
        settings = next
        debug = !!next?.debug
      }
    } catch {}
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
    persistenceScheduler.cancel()
  })
</script>

<section class="chat-shell">
  <MessageList
    bind:this={listCmp}
    items={visibleMessages}
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
    onFork={(id) => forkMessage(id)}
    onDebugFuckBranch={(id) => debugFuckUpBranch(id)}
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
    modelIds={modelIds}
    connections={connectionOptions}
    chatConnectionId={chatSettings.connectionId}
    attachedImages={attachedImages}
    keybinds={settings?.keybinds}
    showThinkingControls={!!settings?.showThinkingSettings}
    presets={settings?.presets}
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
    onChangeThinkingEnabled={(val) => (chatSettings = { ...chatSettings, thinkingEnabled: !!val })}
    onChangeThinkingBudgetTokens={(val) => (chatSettings = { ...chatSettings, thinkingBudgetTokens: toIntOrNull(val) })}
    onSelectPreset={handleSelectPreset}
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
    />
  {/if}
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
