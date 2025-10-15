// Chat persistence with signature tracking
import { saveChatContent } from '../../chatsStore.js'
import { sanitizeGraphIfNeeded } from './graphValidation.js'

function sanitizeImages(images, stripData = false) {
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
      if (!stripData && typeof entry.data === 'string' && entry.data) data = entry.data
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
    if (!stripData && data) img.data = data
    map.set(id, img)
  }
  return [...map.values()]
}

function sanitizeVariantImages(variant) {
  if (!variant || typeof variant !== 'object') return { variant, changed: false }
  const imagesInput = variant.images
  const normalized = sanitizeImages(imagesInput, true)
  const hasImages = normalized.length > 0

  if (!Array.isArray(imagesInput)) {
    if (!hasImages && !('images' in variant)) return { variant, changed: false }
    const cleaned = { ...variant }
    if (hasImages) {
      cleaned.images = normalized
    } else {
      delete cleaned.images
    }
    return { variant: cleaned, changed: true }
  }

  const originalImages = imagesInput

  if (!hasImages) {
    if (!originalImages.length) return { variant, changed: false }
    const cleaned = { ...variant }
    delete cleaned.images
    return { variant: cleaned, changed: true }
  }

  let needsUpdate = originalImages.length !== normalized.length
  if (!needsUpdate) {
    for (let i = 0; i < normalized.length; i++) {
      const orig = originalImages[i]
      const norm = normalized[i]
      const origId = typeof orig === 'string' ? orig.trim() : (orig && typeof orig.id === 'string' ? orig.id : null)
      const origMime = (orig && typeof orig.mimeType === 'string') ? orig.mimeType.trim() : ''
      const origName = (orig && typeof orig.name === 'string') ? orig.name.trim() : ''
      const origHasData = !!(orig && typeof orig === 'object' && typeof orig.data === 'string' && orig.data)
      if (origId !== norm.id || origMime !== (norm.mimeType || '') || origName !== (norm.name || '') || origHasData) {
        needsUpdate = true
        break
      }
    }
  }

  if (!needsUpdate) return { variant, changed: false }
  return { variant: { ...variant, images: normalized }, changed: true }
}

function stripImageDataFromNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : []
  let mutated = false
  const sanitizedNodes = list.map((node) => {
    if (!node || typeof node !== 'object') return node
    const variants = Array.isArray(node.variants) ? node.variants : []
    let variantsChanged = false
    const sanitizedVariants = variants.map(variant => {
      const { variant: sanitized, changed } = sanitizeVariantImages(variant)
      if (changed) variantsChanged = true
      return sanitized
    })
    if (!variantsChanged) return node
    mutated = true
    return { ...node, variants: sanitizedVariants }
  })
  return mutated ? sanitizedNodes : nodes
}

export function computePersistSig(nodes, chatSettings, rootId) {
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
        reasoningSummary: chatSettings?.reasoningSummary || '',
        thinkingEnabled: !!chatSettings?.thinkingEnabled,
        thinkingBudgetTokens: chatSettings?.thinkingBudgetTokens ?? null,
        connectionId: chatSettings?.connectionId || '',
      },
      rootId,
    })
  } catch {
    return ''
  }
}

export async function persistChatContent(chatId, nodes, chatSettings, rootId, debug, mounted) {
  try {
    if (!chatId || !mounted) return { updated: null, notice: '' }

    // Enforce invariant before persisting
    const { nodes: sanitized, notice } = sanitizeGraphIfNeeded(nodes, rootId, debug)
    const cleanedNodes = stripImageDataFromNodes(sanitized)

    // Persist full graph
    const updated = await saveChatContent(chatId, {
      nodes: cleanedNodes,
      settings: chatSettings,
      rootId
    })

    return { updated, notice, nodes: cleanedNodes }
  } catch (err) {
    return { updated: null, notice: '', nodes }
  }
}
