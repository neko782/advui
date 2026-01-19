<script lang="ts">
  // Core imports
  import { onMount, onDestroy, untrack } from 'svelte'
  import { loadSettings, findConnection } from './settingsStore'
  import { ensureModels, loadModelsCache } from './modelsStore'
  import { saveChatContent, debugSetChatLockState } from './chatsStore'
  import { copyText as copyToClipboard } from './utils/clipboard'
  import MessageList from './components/chat/MessageList.svelte'
  import Composer from './components/chat/Composer.svelte'
  import ConfirmModal from './components/ConfirmModal.svelte'
  import { storeImage, generateImageId, fileToBase64, getImage } from './imageStore'

  // Chat module imports
  import { loadChat } from './chat/services/chatLoader'
  import { pickPresetFromSettings, presetSignature } from './chat/services/chatInit'
  import { persistChatContent, computePersistSig } from './chat/services/chatPersistence'
  import { computeValidationNotice, computeGenerationNotice, assembleNotice, computeFollowingMap } from './chat/services/noticeHelpers'
  import { resolveConnectionContext as _resolveConnectionContext } from './chat/services/connectionResolver'
  import { createPersistenceScheduler, queueGlobalPersist, flushGlobalPersists } from './chat/services/persistenceScheduler'
  import { createNoticeManager } from './chat/services/noticeManager'
  import { createGenerationStateManager } from './chat/services/generationStateManager'
  import { createEditStateManager } from './chat/services/editStateManager'
  import { validateChatEdit } from './chat/services/chatEditGuard'

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
  import type { Node, Message, ChatSettings, AppSettings, ImageRef, Image, MessageRole, VisibleMessage } from './types'

  interface Props {
    chatId: string
    onNewChat?: (options?: { presetId?: string }) => void
    onChatUpdated?: () => void
    settingsVersion?: number
    onGeneratingChange?: (chatId: string, isGenerating: boolean) => void
    appSettings?: AppSettings | null
  }

  const props: Props = $props()

  // Managers
  const persistenceScheduler = createPersistenceScheduler()
  const noticeManager = createNoticeManager()
  const generationState = createGenerationStateManager()
  const editStateManager = createEditStateManager()

  // State
  let nodes = $state<Node[]>([])
  let rootId = $state<number | null>(1)
  let input = $state('')
  let attachedImages = $state<Image[]>([])
  let imageCache = $state<Record<string, { data: string; mimeType?: string; name?: string }>>({})
  let sending = $state(false)
  let forcedLock = $state(false)
  let locked = $state(false)

  // Track the chatId that started the current generation to avoid race conditions
  let generationChatId: string | null = null

  // Synchronously notify parent when sending changes to avoid race conditions with unmounting
  function setSending(value: boolean, forChatId?: string) {
    sending = value
    // Use the provided chatId, or fall back to the generation chatId, or current props
    const chatId = forChatId ?? generationChatId ?? props.chatId
    if (chatId) {
      try { props.onGeneratingChange?.(chatId, value) } catch {}
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
  let lastChatId: string | null = null

  // Settings & chat configuration
  // Prefer settings from prop (shared across all chats) over loading independently
  const initialSettings = props.appSettings ?? loadSettings()
  let settings = $state<AppSettings>(initialSettings)
  let debug = $state(!!initialSettings?.debug)

  // Sync settings from prop when it changes (single source of truth from parent)
  $effect(() => {
    if (props.appSettings) {
      settings = props.appSettings
      debug = !!props.appSettings.debug
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
  })

  let chatSettingsOpen = $state(false)
  let modelIds = $state<string[]>(loadModelsCache(initialConnectionId).ids || [])
  let persistedSig = ''
  let scheduledPersistSig = ''
  let persistRetryTimer: ReturnType<typeof setTimeout> | null = null

  // Editing state
  let editingId = $state<number | null>(null)
  let editingText = $state('')

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

  function registerAbortHandler(fn) {
    generationState.registerAbortHandler(fn)
  }

  function finishGeneration() {
    setSending(false)
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
  function schedulePersistRetry(delayMs: number = 750) {
    if (persistRetryTimer) return
    persistRetryTimer = setTimeout(() => {
      persistRetryTimer = null
      const cid = props.chatId
      if (!cid || !ready || !mounted || destroyed) return
      try {
        const desired = computePersistSig(nodes, chatSettings, rootId)
        if (desired === persistedSig) return
        // Force a new schedule attempt even if we previously "scheduled" this sig.
        scheduledPersistSig = ''
        queueGlobalPersist(cid, async () => {
          await persistNow()
        })
      } catch {}
    }, delayMs)
  }

  async function persistNow() {
    const cid = props.chatId
    if (!cid || !mounted) return
    try {
      const result = await persistChatContent(cid, nodes, chatSettings, rootId, debug, mounted)
      if (destroyed) return
      if (result.notice) {
        // Only update in-memory state if sanitization actually made corrections
        sanitizerNotice = result.notice
        if (result.nodes !== nodes) nodes = result.nodes
        if (result.rootId !== rootId) rootId = result.rootId
      }
      persistedSig = computePersistSig(nodes, chatSettings, rootId)
      scheduledPersistSig = persistedSig
      if (persistRetryTimer) {
        clearTimeout(persistRetryTimer)
        persistRetryTimer = null
      }
      scheduleParentRefresh(result.updated)
    } catch (err) {
      if (destroyed) return
      const msg = (err as Error)?.message || ''
      if (msg.includes('Concurrent modification conflict')) {
        sanitizerNotice = `Failed to save: this chat was modified in another tab. Reload the page to sync.`
        scheduledPersistSig = persistedSig
        return
      }
      sanitizerNotice = msg ? `Failed to save chat: ${msg}` : 'Failed to save chat.'
      scheduledPersistSig = persistedSig
      schedulePersistRetry()
    }
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
    if (type.startsWith('video/')) return true
    if (type.startsWith('audio/')) return true
    if (type === 'application/pdf') return true
    if (!type && typeof file.name === 'string') {
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.pdf')) return true
      if (/\.(png|jpe?g|gif|webp)$/i.test(lower)) return true
      if (/\.(mp4|webm|mov|avi)$/i.test(lower)) return true
      if (/\.(mp3|wav|ogg|m4a)$/i.test(lower)) return true
    }
    if (type === 'application/octet-stream' && typeof file.name === 'string') {
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.pdf')) return true
      if (/\.(mp4|webm|mov|avi)$/i.test(lower)) return true
      if (/\.(mp3|wav|ogg|m4a)$/i.test(lower)) return true
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
      // Video types
      if (lower.endsWith('.mp4')) return 'video/mp4'
      if (lower.endsWith('.webm')) return 'video/webm'
      if (lower.endsWith('.mov')) return 'video/quicktime'
      if (lower.endsWith('.avi')) return 'video/x-msvideo'
      // Audio types
      if (lower.endsWith('.mp3')) return 'audio/mpeg'
      if (lower.endsWith('.wav')) return 'audio/wav'
      if (lower.endsWith('.ogg')) return 'audio/ogg'
      if (lower.endsWith('.m4a')) return 'audio/mp4'
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
      await persistNow()
    } catch (err) {
      logGenerationEvent(debug, 'Generation error', { error: err?.message, typingVariantId })
      if (generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationError(nodes, typingVariantId, err)
      }
      await persistNow()
    } finally {
      const isCurrentGen = generationState.getGenerationSequence() === genSeq
      if (isCurrentGen) {
        generationState.completeGeneration(genSeq)
      }
      if (isCurrentGen || !generationState.isGenerationActive()) {
        finishGeneration()
        logGenerationEvent(debug, 'Generation finished', { sequence: genSeq, wasCurrentGen: isCurrentGen })
      }
    }
  }

  function cancelEdit() {
    editStateManager.finishEdit(false)
    editingId = null
    editingText = ''
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
    attachedImages = []

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

    try {
      let reply = null
      let summaryBuffer = ''
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

      if (generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationSuccess(nodes, typingVariantId, reply, summaryBuffer)
      }
      await persistNow()
    } catch (err) {
      logGenerationEvent(debug, 'Generation error', { error: err?.message, typingVariantId, role })
      if (generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationError(nodes, typingVariantId, err)
      }
      await persistNow()
    } finally {
      const isCurrentGen = generationState.getGenerationSequence() === genSeq
      if (isCurrentGen) {
        generationState.completeGeneration(genSeq)
      }
      // Always clean up if we're the current gen, or if no generation is active
      // (handles case where a newer generation already started and finished)
      if (isCurrentGen || !generationState.isGenerationActive()) {
        finishGeneration()
        logGenerationEvent(debug, 'Generation finished', { sequence: genSeq, wasCurrentGen: isCurrentGen })
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
    const imageRefs = buildImageRefs(attachedImages)
    const hasImages = imageRefs.length > 0
    const inserted = appendMessage(role, text, hasImages ? imageRefs : [])
    if (inserted == null) return
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
      await persistNow()
    } catch (err) {
      logGenerationEvent(debug, 'Generation error', { error: err?.message, typingVariantId })
      if (generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationError(nodes, typingVariantId, err)
      }
      await persistNow()
    } finally {
      const isCurrentGen = generationState.getGenerationSequence() === genSeq
      if (isCurrentGen) {
        generationState.completeGeneration(genSeq)
      }
      if (isCurrentGen || !generationState.isGenerationActive()) {
        finishGeneration()
        logGenerationEvent(debug, 'Generation finished', { sequence: genSeq, wasCurrentGen: isCurrentGen })
      }
    }
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
      await persistNow()
    } catch (err) {
      logGenerationEvent(debug, 'Generation error', { error: err?.message, typingVariantId })
      if (generationState.getGenerationSequence() === genSeq) {
        nodes = handleGenerationError(nodes, typingVariantId, err)
      }
      await persistNow()
    } finally {
      const isCurrentGen = generationState.getGenerationSequence() === genSeq
      if (isCurrentGen) {
        generationState.completeGeneration(genSeq)
      }
      if (isCurrentGen || !generationState.isGenerationActive()) {
        finishGeneration()
        logGenerationEvent(debug, 'Generation finished', { sequence: genSeq, wasCurrentGen: isCurrentGen })
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
      // Web Search settings
      webSearchEnabled: typeof preset.webSearchEnabled === 'boolean' ? preset.webSearchEnabled : chatSettings.webSearchEnabled,
      webSearchDomains: preset.webSearchDomains ?? chatSettings.webSearchDomains,
      webSearchCountry: preset.webSearchCountry ?? chatSettings.webSearchCountry,
      webSearchCity: preset.webSearchCity ?? chatSettings.webSearchCity,
      webSearchRegion: preset.webSearchRegion ?? chatSettings.webSearchRegion,
      webSearchTimezone: preset.webSearchTimezone ?? chatSettings.webSearchTimezone,
      webSearchCacheOnly: typeof preset.webSearchCacheOnly === 'boolean' ? preset.webSearchCacheOnly : chatSettings.webSearchCacheOnly,
      // Image Generation settings
      imageGenerationEnabled: typeof preset.imageGenerationEnabled === 'boolean' ? preset.imageGenerationEnabled : chatSettings.imageGenerationEnabled,
      imageGenerationModel: preset.imageGenerationModel ?? chatSettings.imageGenerationModel,
    }
    persistNow()
  }

  // Lifecycle effects
  let loadedChatId: string | null = null
  $effect(() => {
    const cid = props.chatId
	    if (lastChatId && lastChatId !== cid && mounted) {
	      // Use untrack to prevent this effect from re-running when nodes/settings change
	      untrack(() => {
	        try { saveChatContent(lastChatId, { nodes, settings: chatSettings, rootId }).catch(() => {}) } catch {}
	      })
	    }
	    lastChatId = cid

    // Skip if we've already loaded this chat
    if (loadedChatId === cid) return

	    ready = false
	    forcedLock = false
	    persistedSig = ''
	    scheduledPersistSig = ''
	    chatSettingsOpen = false

    if (!cid) return

    loadChat(cid).then((result) => {
      // Skip if we switched to a different chat while loading, or user started editing
      if (props.chatId !== cid || editingId !== null) {
        ready = true
        loadedChatId = cid
        return
      }
      try {
        settings = result.settings
        const sanitizedNodes = sanitizeNodesImageData(result.nodes)
        nodes = sanitizedNodes
        nextId = result.nextId
        nextNodeId = result.nextNodeId
        chatSettings = result.chatSettings
        try { modelIds = loadModelsCache(result.chatSettings?.connectionId).ids || [] } catch {}
        rootId = result.rootId
	        editStateManager.forceClear()
	        editingId = null
	        editingText = ''
	        dismissedNotice = ''
	        persistedSig = result.persistSig
	        scheduledPersistSig = result.persistSig
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

  // Fallback: reload settings from storage when settingsVersion changes (only if appSettings prop not provided)
  let lastSettingsVersion = 0
  $effect(() => {
    const v = Number(props.settingsVersion) || 0
    if (v === lastSettingsVersion) return
    lastSettingsVersion = v
    // Skip if settings are provided via prop (handled by prop sync effect)
    if (props.appSettings) return
    try {
      const next = loadSettings()
      settings = next
      debug = !!next?.debug
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
	      if (sig === persistedSig || sig === scheduledPersistSig) return
	      scheduledPersistSig = sig
	      // Use global throttle to prevent storage write storms across multiple chats
	      queueGlobalPersist(cid, async () => {
	        await persistNow()
	      })
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
    destroyed = true
    const chatId = props.chatId
    // Abort any in-flight generation to prevent orphaned HTTP requests
    if (generationState.isGenerationActive()) {
      generationState.requestAbort()
    }
    if (!chatId) return
    try { props.onGeneratingChange?.(chatId, false) } catch {}
    persistenceScheduler.cancel()

    // Best-effort: flush any pending throttled persists for this chat
    try {
      queueGlobalPersist(chatId, async () => {
        await persistNow()
      })
      void flushGlobalPersists()
    } catch {}
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
    allowInlineHtml={settings?.allowInlineHtml}
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
    chatImageGenerationEnabled={chatSettings.imageGenerationEnabled}
    chatImageGenerationModel={chatSettings.imageGenerationModel}
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
    onChangeWebSearchEnabled={(val) => (chatSettings = { ...chatSettings, webSearchEnabled: !!val })}
    onChangeImageGenerationEnabled={(val) => (chatSettings = { ...chatSettings, imageGenerationEnabled: !!val })}
    onChangeImageGenerationModel={(val) => (chatSettings = { ...chatSettings, imageGenerationModel: val || undefined })}
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
