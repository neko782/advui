// Generation actions: send, refresh assistant, refresh after user
import { respond } from '../../openaiClient.js'
import { buildVisible as _buildVisible, buildVisibleUpTo as _buildVisibleUpTo } from '../../branching.js'
import { isAbortError } from '../../utils/errors.js'
import { updateVariantById } from './variantActions.js'
import { findNodeByMessageId } from '../../utils/treeUtils.js'

function normalizeImages(images) {
  if (!Array.isArray(images)) return []
  const map = new Map()
  for (const entry of images) {
    if (entry == null) continue
    let id = null
    let mimeType
    let name
    let data
    if (typeof entry === 'string') {
      id = entry.trim()
      if (!id) continue
    } else if (typeof entry === 'object') {
      id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null
      if (!id) continue
      if (typeof entry.mimeType === 'string' && entry.mimeType.trim()) mimeType = entry.mimeType.trim()
      if (typeof entry.name === 'string' && entry.name.trim()) name = entry.name.trim()
      if (typeof entry.data === 'string' && entry.data) data = entry.data
    } else {
      continue
    }

    const existing = map.get(id)
    if (existing) {
      if (!existing.mimeType && mimeType) existing.mimeType = mimeType
      if (!existing.name && name) existing.name = name
      if (!existing.data && data) existing.data = data
      continue
    }

    const img = { id }
    if (mimeType) img.mimeType = mimeType
    if (name) img.name = name
    if (data) img.data = data
    map.set(id, img)
  }
  return [...map.values()]
}

export function prepareUserMessage(nodes, rootId, input, nextId, nextNodeId, images = []) {
  const buildVisible = () => _buildVisible(nodes, rootId)
  const visible = buildVisible()
  const lastVm = visible.length ? visible[visible.length - 1] : null
  const parentNodeId = lastVm ? lastVm.nodeId : null

  const trimmedInput = (typeof input === 'string' ? input : '').trim()
  const normalizedImages = normalizeImages(images)
  const hasImages = normalizedImages.length > 0
  if (!trimmedInput && !hasImages) return null

  const newMsg = {
    id: nextId,
    role: 'user',
    content: trimmedInput,
    time: Date.now(),
    typing: false,
    error: undefined,
    next: null,
    images: hasImages ? normalizedImages : undefined
  }
  const newNode = { id: nextNodeId, variants: [newMsg], active: 0 }
  const newNodeId = newNode.id

  let arr = nodes.slice()
  arr.push(newNode)

  let nextRootId = rootId
  if (parentNodeId != null) {
    arr = arr.map(n => (n.id === parentNodeId
      ? { ...n, variants: n.variants.map((v, i) => (i === (Number(n.active)||0) ? { ...v, next: newNode.id } : v)) }
      : n))
  } else {
    nextRootId = newNode.id
  }

  return {
    nodes: arr,
    rootId: nextRootId,
    nextId: nextId + 1,
    nextNodeId: nextNodeId + 1,
    newNodeId
  }
}

export function prepareTypingNode(nodes, rootId, parentNodeId, nextId, nextNodeId) {
  const typingVariant = {
    id: nextId,
    role: 'assistant',
    content: 'typing',
    time: Date.now(),
    typing: true,
    error: undefined,
    next: null,
    reasoningSummary: '',
    reasoningSummaryLoading: true,
  }
  const typingVariantId = typingVariant.id
  const typingNode = { id: nextNodeId, variants: [typingVariant], active: 0 }

  let arr = nodes.slice()
  let nextRootId = rootId

  if (parentNodeId != null) {
    arr = arr.map(n => {
      if (n.id !== parentNodeId) return n
      const activeIndex = Math.max(0, Math.min((n.variants?.length || 1) - 1, Number(n.active) || 0))
      return {
        ...n,
        variants: n.variants.map((v, i) => (i === activeIndex ? { ...v, next: typingNode.id } : v)),
      }
    })
  } else {
    nextRootId = typingNode.id
  }

  arr = [...arr, typingNode]

  return {
    nodes: arr,
    rootId: nextRootId,
    typingVariantId,
    nextId: nextId + 1,
    nextNodeId: nextNodeId + 1
  }
}

export async function generateResponse({
  nodes,
  rootId,
  chatSettings,
  connectionId,
  streaming,
  typingVariantId,
  onAbort,
  onTextDelta,
  onReasoningSummaryDelta,
  onReasoningSummaryDone
}) {
  const buildVisible = () => _buildVisible(nodes, rootId)
  const history = buildVisible()
    .map(vm => vm.m)
    .filter(m => !m.typing)
    .map(({ role, content, images }) => {
      const msg = { role, content }
      const normalized = normalizeImages(images)
      if (normalized.length > 0) {
        msg.images = normalized
      }
      return msg
    })

  const responseOptions = {
    messages: history,
    model: chatSettings.model,
    maxOutputTokens: chatSettings.maxOutputTokens,
    topP: chatSettings.topP,
    temperature: chatSettings.temperature,
    reasoningEffort: chatSettings.reasoningEffort,
    textVerbosity: chatSettings.textVerbosity,
    reasoningSummary: chatSettings.reasoningSummary,
    connectionId,
  }

  if (streaming && typingVariantId != null) {
    return await respond({
      ...responseOptions,
      stream: true,
      onAbort,
      onTextDelta,
      onReasoningSummaryDelta,
      onReasoningSummaryDone,
    })
  } else {
    return await respond({
      ...responseOptions,
      onAbort,
      onReasoningSummaryDone,
    })
  }
}

export function handleGenerationSuccess(nodes, typingVariantId, reply, summaryBuffer) {
  if (typingVariantId == null) return nodes

  const replyText = (reply && typeof reply === 'object') ? (reply.text ?? '') : (typeof reply === 'string' ? reply : '')
  const replySummary = (() => {
    if (reply && typeof reply === 'object') {
      if (typeof reply.reasoningSummary === 'string' && reply.reasoningSummary) return reply.reasoningSummary
      return summaryBuffer
    }
    return summaryBuffer
  })()

  return updateVariantById(nodes, typingVariantId, (prev) => ({
    ...prev,
    content: replyText,
    typing: false,
    error: undefined,
    reasoningSummary: replySummary || '',
    reasoningSummaryLoading: false,
  }))
}

export function handleGenerationError(nodes, typingVariantId, err) {
  if (typingVariantId == null) return nodes

  const aborted = isAbortError(err)
  if (aborted) {
    return updateVariantById(nodes, typingVariantId, (prev) => ({
      ...prev,
      typing: false,
      error: undefined,
      reasoningSummaryLoading: false,
      content: (prev.content === 'typing' ? '' : prev.content),
    }))
  } else {
    const msg = err?.message || 'Something went wrong.'
    return updateVariantById(nodes, typingVariantId, (prev) => ({
      ...prev,
      typing: false,
      error: msg,
      reasoningSummaryLoading: false,
      content: (prev.content === 'typing' ? '' : prev.content),
    }))
  }
}

export function prepareRefreshAssistant(nodes, rootId, messageId, nextId) {
  const buildVisible = () => _buildVisible(nodes, rootId)
  const buildVisibleUpTo = (indexExclusive) => _buildVisibleUpTo(nodes, rootId, indexExclusive)

  const loc = findNodeByMessageId(nodes, messageId)
  const node = loc?.node
  const target = node?.variants?.[loc.index]
  if (!node || !target || target.role !== 'assistant' || target.typing) return null

  const typingMsg = {
    id: nextId,
    role: 'assistant',
    content: 'typing',
    time: Date.now(),
    typing: true,
    error: undefined,
    next: null,
    reasoningSummary: '',
    reasoningSummaryLoading: true,
  }

  const updatedNodes = nodes.map(n => (
    n.id === node.id
      ? { ...n, variants: [...(n.variants || []), typingMsg], active: (n.variants?.length || 0) }
      : n
  ))

  // Build history up to (but not including) this assistant node
  const path = buildVisible()
  const parentPathIndex = path.findIndex(vm => vm.nodeId === node.id) - 1
  const history = buildVisibleUpTo((parentPathIndex >= 0 ? parentPathIndex + 1 : 0))
    .filter(m => !m.typing)
    .map(({ role, content, images }) => {
      const msg = { role, content }
      const normalized = normalizeImages(images)
      if (normalized.length > 0) {
        msg.images = normalized
      }
      return msg
    })

  return {
    nodes: updatedNodes,
    nextId: nextId + 1,
    typingVariantId: typingMsg.id,
    history
  }
}

export function prepareRefreshAfterUser(nodes, rootId, messageIndex, nextId, nextNodeId) {
  const buildVisible = () => _buildVisible(nodes, rootId)
  const buildVisibleUpTo = (indexExclusive) => _buildVisibleUpTo(nodes, rootId, indexExclusive)

  const path = buildVisible()
  const vm = (typeof messageIndex === 'number') ? path[messageIndex] : null
  const curMsg = vm?.m
  const curNodeId = vm?.nodeId
  if (!curMsg || !curNodeId) return null

  const typingMsg = {
    id: nextId,
    role: 'assistant',
    content: 'typing',
    time: Date.now(),
    typing: true,
    error: undefined,
    next: null,
    reasoningSummary: '',
    reasoningSummaryLoading: true,
  }

  const typingNode = { id: nextNodeId, variants: [typingMsg], active: 0 }
  let updatedNodes = nodes.map(n => (
    n.id === curNodeId
      ? { ...n, variants: n.variants.map((v, idx) => (idx === (Number(n.active)||0) ? { ...v, next: typingNode.id } : v)) }
      : n
  ))
  updatedNodes = [...updatedNodes, typingNode]

  const history = buildVisibleUpTo(messageIndex + 1)
    .filter(m => !m.typing)
    .map(({ role, content, images }) => {
      const msg = { role, content }
      const normalized = normalizeImages(images)
      if (normalized.length > 0) {
        msg.images = normalized
      }
      return msg
    })

  return {
    nodes: updatedNodes,
    nextId: nextId + 1,
    nextNodeId: nextNodeId + 1,
    typingVariantId: typingMsg.id,
    history
  }
}
