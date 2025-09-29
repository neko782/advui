// Variant/branching actions

function findNodeByMessageId(nodes, mid) {
  for (const n of nodes || []) {
    const i = (n?.variants || []).findIndex(v => v?.id === mid)
    if (i >= 0) return { node: n, index: i }
  }
  return { node: null, index: -1 }
}

export function changeVariant(nodes, messageId, delta) {
  const loc = findNodeByMessageId(nodes, messageId)
  const parent = loc?.node
  if (!parent || (parent.variants || []).length <= 1) return nodes

  const len = parent.variants.length
  const cur = Number(parent.active) || 0
  const next = Math.max(0, Math.min(len - 1, cur + delta))
  if (next === cur) return nodes

  return nodes.map(n => (n.id === parent.id ? { ...n, active: next } : n))
}

export function updateVariantById(nodes, variantId, transform) {
  if (variantId == null) return nodes

  return nodes.map(n => {
    const variants = Array.isArray(n?.variants) ? n.variants : []
    let changed = false
    const nextVariants = variants.map(v => {
      if (v?.id !== variantId) return v
      changed = true
      if (typeof transform === 'function') {
        return transform(v)
      }
      return { ...v, ...(transform || {}) }
    })
    return changed ? { ...n, variants: nextVariants } : n
  })
}