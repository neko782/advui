// Message manipulation actions: delete, role change, move up/down
import { VALID_MESSAGE_ROLES } from '../../constants/index.js'
import { buildVisible as _buildVisible } from '../../branching.js'

function findNodeByMessageId(nodes, mid) {
  for (const n of nodes || []) {
    const i = (n?.variants || []).findIndex(v => v?.id === mid)
    if (i >= 0) return { node: n, index: i }
  }
  return { node: null, index: -1 }
}

export function deleteMessage(nodes, rootId, messageId) {
  const loc = findNodeByMessageId(nodes, messageId)
  if (!loc?.node) return { nodes, rootId }
  if (loc.node.id === rootId) return { nodes, rootId } // do not allow deleting root node

  // Collect subtree starting from this node by following any variant next pointers
  const toDelete = new Set()
  function collect(nodeId) {
    if (toDelete.has(nodeId)) return
    toDelete.add(nodeId)
    const n = nodes.find(nn => nn.id === nodeId)
    for (const v of n?.variants || []) {
      if (v?.next != null) collect(v.next)
    }
  }
  collect(loc.node.id)

  // Remove nodes and clean dangling next pointers
  const remaining = nodes.filter(n => !toDelete.has(n.id))
  const cleaned = remaining.map(n => ({
    ...n,
    variants: (n.variants || []).map(v => (toDelete.has(Number(v?.next)) ? { ...v, next: null } : v))
  }))

  return { nodes: cleaned, rootId }
}

export function setMessageRole(nodes, id, role) {
  if (!VALID_MESSAGE_ROLES.has(role)) return nodes

  return nodes.map(n => ({
    ...n,
    variants: (n.variants || []).map(v => (v.id === id ? { ...v, role } : v))
  }))
}

export function moveUp(nodes, rootId, messageId) {
  const buildVisible = () => _buildVisible(nodes, rootId)
  const path = buildVisible()
  const idx = path.findIndex(vm => vm.m.id === messageId)
  if (idx <= 0) return { nodes, rootId }

  const B = path[idx]
  const A = path[idx - 1]
  const P = (idx - 2 >= 0) ? path[idx - 2] : null
  const C = (idx + 1 < path.length) ? path[idx + 1] : null

  if (!A || !B) return { nodes, rootId }
  if (B.m?.typing) return { nodes, rootId }

  let arr = nodes.slice()
  function setActiveNext(mid, toId) {
    arr = arr.map(n => (n.id === mid
      ? { ...n, variants: n.variants.map((v, i) => (i === (Number(n.active)||0) ? { ...v, next: toId ?? null } : v)) }
      : n))
  }

  const nextRootId = P ? rootId : B.nodeId
  if (P) { setActiveNext(P.nodeId, B.nodeId) }
  setActiveNext(B.nodeId, A.nodeId)
  setActiveNext(A.nodeId, C ? C.nodeId : null)

  return { nodes: arr, rootId: nextRootId }
}

export function moveDown(nodes, rootId, messageId) {
  const buildVisible = () => _buildVisible(nodes, rootId)
  const path = buildVisible()
  const idx = path.findIndex(vm => vm.m.id === messageId)
  if (idx < 0 || idx >= (path.length - 1)) return { nodes, rootId }

  const B = path[idx]
  const C = path[idx + 1]
  const P = (idx - 1 >= 0) ? path[idx - 1] : null
  const D = (idx + 2 < path.length) ? path[idx + 2] : null

  if (!B || !C) return { nodes, rootId }
  if (B.m?.typing) return { nodes, rootId }

  let arr = nodes.slice()
  function setActiveNext(mid, toId) {
    arr = arr.map(n => (n.id === mid
      ? { ...n, variants: n.variants.map((v, i) => (i === (Number(n.active)||0) ? { ...v, next: toId ?? null } : v)) }
      : n))
  }

  const nextRootId = P ? rootId : C.nodeId
  if (P) { setActiveNext(P.nodeId, C.nodeId) }
  setActiveNext(C.nodeId, B.nodeId)
  setActiveNext(B.nodeId, D ? D.nodeId : null)

  return { nodes: arr, rootId: nextRootId }
}