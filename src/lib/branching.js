// Branching helpers: Graph-based conversation with explicit next pointers.

// messages: array of { id, role, content, time, next?: number[], typing?, error? }
// rootId: id of root message
// selected: map of messageId -> selected child index

export function indexById(messages) {
  const map = new Map()
  for (const m of messages || []) map.set(m.id, m)
  return map
}

export function buildVisible(messages, rootId, selected) {
  const byId = indexById(messages)
  const out = []
  let curId = rootId
  let pathIndex = 0
  const guard = new Set()
  while (curId != null) {
    const m = byId.get(curId)
    if (!m || guard.has(curId)) break
    guard.add(curId)
    out.push({ m, i: pathIndex })
    pathIndex++
    const children = Array.isArray(m.next) ? m.next : []
    if (!children.length) break
    const sel = Math.max(0, Math.min(children.length - 1, Number(selected?.[m.id]) || 0))
    curId = children[sel]
  }
  return out
}

export function buildVisibleUpTo(messages, rootId, selected, indexExclusive) {
  const full = buildVisible(messages, rootId, selected)
  const upto = Math.max(0, Math.min(indexExclusive ?? 0, full.length))
  return full.slice(0, upto).map(vm => vm.m)
}

export function findParentId(messages, childId) {
  for (const m of messages || []) {
    if (Array.isArray(m.next) && m.next.includes(childId)) return m.id
  }
  return null
}
