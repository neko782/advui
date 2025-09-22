// Branching helpers: node-based conversation graph.
// New architecture:
// - nodes: array of { id, variants: Message[], active?: number }
// - A "Message" (aka variant) is { id, role, content, time, typing?, error?, next?: number|null }
// - Each variant has at most one `next` (points to the id of the next node)
// - Each node chooses its active variant via `active` (default 0)

export function indexNodesById(nodes) {
  const map = new Map()
  for (const n of nodes || []) map.set(n.id, n)
  return map
}

export function buildVisible(nodes, rootId) {
  const byId = indexNodesById(nodes)
  const out = []
  let curId = rootId
  let pathIndex = 0
  const guard = new Set()
  while (curId != null) {
    const node = byId.get(curId)
    if (!node || guard.has(curId)) break
    guard.add(curId)
    const variants = Array.isArray(node.variants) ? node.variants : []
    const vi = Math.max(0, Math.min(variants.length - 1, Number(node.active) || 0))
    const m = variants[vi]
    if (!m) break
    out.push({ m, i: pathIndex, nodeId: node.id, variantIndex: vi, variantsLength: variants.length })
    pathIndex++
    const nxt = (m && m.next != null) ? m.next : null
    curId = nxt
  }
  return out
}

export function buildVisibleUpTo(nodes, rootId, indexExclusive) {
  const full = buildVisible(nodes, rootId)
  const upto = Math.max(0, Math.min(indexExclusive ?? 0, full.length))
  return full.slice(0, upto).map(vm => vm.m)
}

export function findParentId(nodes, childNodeId) {
  for (const n of nodes || []) {
    const variants = Array.isArray(n.variants) ? n.variants : []
    if (variants.some(v => v?.next === childNodeId)) return n.id
  }
  return null
}
