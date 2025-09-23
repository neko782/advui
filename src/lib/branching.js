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

// Validate that the node/variant graph forms a tree (no merges, no cycles)
// and that no two messages (variants) lead to the same node.
// Returns a summary with problems suitable for user notification.
export function validateTree(nodes, rootId) {
  const problems = []
  const details = {
    duplicateNodeIds: [],
    multipleParents: new Map(), // nodeId -> [ { fromNodeId, variantIndex, variantId } ]
    missingTargets: new Set(),
    cycles: [], // array of arrays (cycle paths)
    multipleRoots: [],
    rootHasParent: false,
    unreachableFromRoot: new Set(),
  }

  // Basic presence
  const list = Array.isArray(nodes) ? nodes : []
  const idCounts = new Map()
  for (const n of list) {
    const id = Number(n?.id)
    if (!Number.isFinite(id)) continue
    idCounts.set(id, (idCounts.get(id) || 0) + 1)
  }
  for (const [id, c] of idCounts.entries()) if (c > 1) details.duplicateNodeIds.push(id)
  if (details.duplicateNodeIds.length) problems.push(`Duplicate node ids: ${details.duplicateNodeIds.join(', ')}`)

  const byId = indexNodesById(list)
  const allNodeIds = new Set(byId.keys())

  // Build incoming edges map; record missing targets
  const incoming = new Map()
  for (const n of list) {
    const variants = Array.isArray(n?.variants) ? n.variants : []
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i]
      const tgt = (v && v.next != null) ? Number(v.next) : null
      if (tgt == null) continue
      if (!allNodeIds.has(tgt)) { details.missingTargets.add(tgt); continue }
      const arr = incoming.get(tgt) || []
      arr.push({ fromNodeId: Number(n.id), variantIndex: i, variantId: Number(v.id) })
      incoming.set(tgt, arr)
    }
  }
  if (details.missingTargets.size) problems.push(`Broken links to missing nodes: ${[...details.missingTargets].join(', ')}`)

  // No two messages should lead to the same node => incoming count <= 1 per node
  for (const [tgt, arr] of incoming.entries()) {
    if (arr.length > 1) details.multipleParents.set(tgt, arr)
  }
  if (details.multipleParents.size) {
    const sample = [...details.multipleParents.keys()].slice(0, 5)
    problems.push(`Merge detected: multiple parents for node(s) ${sample.join(', ')}${details.multipleParents.size > 5 ? '…' : ''}`)
  }

  // Root checks
  const indegree0 = [...allNodeIds].filter(id => (incoming.get(id)?.length || 0) === 0)
  // If specified rootId is non-null, it should be a node and have indegree 0
  if (rootId != null && allNodeIds.size) {
    if (!allNodeIds.has(Number(rootId))) {
      problems.push(`Root id ${rootId} not found among nodes`)
    } else if ((incoming.get(Number(rootId))?.length || 0) > 0) {
      details.rootHasParent = true
      problems.push('Root node has an incoming link (should have none)')
    }
  }
  // Multiple roots (more than one indegree-0 node)
  if (indegree0.length > 1) {
    details.multipleRoots = indegree0
    problems.push(`Multiple roots detected: ${indegree0.slice(0, 5).join(', ')}${indegree0.length > 5 ? '…' : ''}`)
  }

  // Cycle detection on the union graph of all variants' next edges
  const adj = new Map()
  for (const id of allNodeIds) adj.set(id, new Set())
  for (const n of list) {
    const from = Number(n?.id)
    for (const v of (n?.variants || [])) {
      const t = (v && v.next != null) ? Number(v.next) : null
      if (t != null && allNodeIds.has(t)) adj.get(from).add(t)
    }
  }
  const color = new Map() // 0=unseen,1=visiting,2=done
  for (const id of allNodeIds) color.set(id, 0)
  const stack = []
  function dfs(u) {
    color.set(u, 1)
    stack.push(u)
    for (const v of adj.get(u) || []) {
      const c = color.get(v) || 0
      if (c === 0) { dfs(v) }
      else if (c === 1) {
        // found a cycle; record path from v to end of stack
        const start = stack.indexOf(v)
        if (start >= 0) details.cycles.push(stack.slice(start).concat(v))
      }
    }
    stack.pop()
    color.set(u, 2)
  }
  for (const id of allNodeIds) if ((color.get(id) || 0) === 0) dfs(id)
  if (details.cycles.length) problems.push('Cycle detected in conversation graph')

  // Reachability from root across all edges
  const reachable = new Set()
  if (rootId != null && allNodeIds.has(Number(rootId))) {
    const q = [Number(rootId)]
    while (q.length) {
      const u = q.shift()
      if (reachable.has(u)) continue
      reachable.add(u)
      for (const v of adj.get(u) || []) q.push(v)
    }
  }
  for (const id of allNodeIds) if (!reachable.has(id)) details.unreachableFromRoot.add(id)
  if (details.unreachableFromRoot.size && allNodeIds.size) {
    const sample = [...details.unreachableFromRoot].slice(0, 5)
    problems.push(`Nodes detached from root: ${sample.join(', ')}${details.unreachableFromRoot.size > 5 ? '…' : ''}`)
  }

  return { ok: problems.length === 0, problems, details }
}
