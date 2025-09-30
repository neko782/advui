// Chat persistence with signature tracking
import { saveChatContent } from '../../chatsStore.js'
import { sanitizeGraphIfNeeded } from './graphValidation.js'

function sanitizeImages(images) {
  if (!Array.isArray(images)) return []
  const out = []
  const seen = new Set()
  for (const entry of images) {
    if (entry == null) continue
    if (typeof entry === 'string') {
      const id = entry.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push({ id })
      continue
    }
    if (typeof entry !== 'object') continue
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null
    if (!id || seen.has(id)) continue
    const img = { id }
    if (typeof entry.mimeType === 'string' && entry.mimeType.trim()) img.mimeType = entry.mimeType.trim()
    if (typeof entry.name === 'string' && entry.name.trim()) img.name = entry.name.trim()
    seen.add(id)
    out.push(img)
  }
  return out
}

function sanitizeVariantImages(variant) {
  if (!variant || typeof variant !== 'object') return { variant, changed: false }
  const normalized = sanitizeImages(variant.images)
  const hasImages = normalized.length > 0
  const originalImages = Array.isArray(variant.images) ? variant.images : []

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
