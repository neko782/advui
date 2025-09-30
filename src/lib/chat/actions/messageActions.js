// Message manipulation actions: delete, role change, move up/down
import { VALID_MESSAGE_ROLES } from '../../constants/index.js'
import { buildVisible as _buildVisible } from '../../branching.js'
import { findNodeByMessageId } from '../../utils/treeUtils.js'

export function deleteMessage(nodes, rootId, messageId) {
  const loc = findNodeByMessageId(nodes, messageId)
  if (!loc?.node) return { nodes, rootId }
  const deletingRoot = loc.node.id === rootId

  const variants = Array.isArray(loc.node?.variants) ? loc.node.variants : []
  const variant = variants[loc.index]
  const preferredChild = (variant && variant.next != null) ? Number(variant.next) : null

  // Find parent variant pointing to this node (unique parent invariant)
  let parentNodeId = null
  let parentVariantIndex = -1
  for (const n of nodes) {
    const list = Array.isArray(n?.variants) ? n.variants : []
    for (let i = 0; i < list.length; i++) {
      const nextId = list[i]?.next
      if (nextId != null && Number(nextId) === loc.node.id) {
        parentNodeId = n.id
        parentVariantIndex = i
        break
      }
    }
    if (parentNodeId != null) break
  }

  const nodesById = new Map(nodes.map(n => [n.id, n]))

  function collectProtected(nodeId, out, guard = new Set()) {
    if (nodeId == null) return
    const id = Number(nodeId)
    if (!Number.isFinite(id) || guard.has(id)) return
    guard.add(id)
    const node = nodesById.get(id)
    if (!node) return
    out.add(id)
    for (const v of node?.variants || []) {
      if (v?.next != null) collectProtected(v.next, out, guard)
    }
  }

  const protectedNodes = new Set()
  if (preferredChild != null) collectProtected(preferredChild, protectedNodes)

  const toDelete = new Set([loc.node.id])
  function collect(nodeId, guard = new Set()) {
    if (nodeId == null) return
    const id = Number(nodeId)
    if (!Number.isFinite(id) || guard.has(id) || protectedNodes.has(id)) return
    guard.add(id)
    toDelete.add(id)
    const node = nodesById.get(id)
    if (!node) return
    for (const v of node?.variants || []) {
      if (v?.next != null) collect(v.next, guard)
    }
  }

  for (const v of variants) {
    if (v?.next == null) continue
    const nextId = Number(v.next)
    if (!Number.isFinite(nextId)) continue
    if (preferredChild != null && nextId === preferredChild) continue
    collect(nextId)
  }

  // Remove nodes and clean dangling next pointers
  const remaining = nodes.filter(n => !toDelete.has(n.id))
  const toDeleteNumeric = new Set([...toDelete].map(Number))
  const cleaned = remaining.map(n => ({
    ...n,
    variants: (n.variants || []).map((v, i) => {
      let nextVal = v?.next ?? null
      if (Number.isFinite(Number(nextVal)) && toDeleteNumeric.has(Number(nextVal))) {
        nextVal = null
      }
      if (n.id === parentNodeId && i === parentVariantIndex) {
        nextVal = preferredChild ?? null
      }
      return (nextVal === v?.next)
        ? v
        : { ...v, next: nextVal }
    })
  }))

  if (!cleaned.length) {
    return { nodes: cleaned, rootId: deletingRoot ? null : rootId }
  }

  let nextRootId = rootId
  if (deletingRoot) {
    nextRootId = preferredChild ?? null
  }

  const rootStillExists = cleaned.some(n => n.id === nextRootId)
  if (!rootStillExists) {
    const remainingKeys = new Set(cleaned.map(n => n.id))
    const hasParent = new Set()
    for (const n of cleaned) {
      for (const v of n.variants || []) {
        const nextId = Number(v?.next)
        if (Number.isFinite(nextId) && remainingKeys.has(nextId)) hasParent.add(nextId)
      }
    }

    const fallbackRoot = cleaned.find(n => !hasParent.has(n.id)) || cleaned[0]
    nextRootId = fallbackRoot ? fallbackRoot.id : null
  }

  return { nodes: cleaned, rootId: nextRootId }
}

export function setMessageRole(nodes, id, role) {
  if (!VALID_MESSAGE_ROLES.has(role)) return nodes

  return nodes.map(n => ({
    ...n,
    variants: (n.variants || []).map(v => (v.id === id ? { ...v, role } : v))
  }))
}

function moveMessage(nodes, rootId, messageId, direction) {
  const buildVisible = () => _buildVisible(nodes, rootId)
  const path = buildVisible()
  const currentIdx = path.findIndex(vm => vm.m.id === messageId)

  // Validate bounds
  if (direction === 'up' && currentIdx <= 0) return { nodes, rootId }
  if (direction === 'down' && (currentIdx < 0 || currentIdx >= path.length - 1)) return { nodes, rootId }

  const current = path[currentIdx]
  const swapIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1
  const swap = path[swapIdx]
  const before = direction === 'up' ? (currentIdx - 2 >= 0 ? path[currentIdx - 2] : null) : (currentIdx - 1 >= 0 ? path[currentIdx - 1] : null)
  const after = direction === 'up' ? (currentIdx + 1 < path.length ? path[currentIdx + 1] : null) : (currentIdx + 2 < path.length ? path[currentIdx + 2] : null)

  if (!current || !swap || current.m?.typing) return { nodes, rootId }

  let arr = nodes.slice()
  function setActiveNext(nodeId, nextNodeId) {
    arr = arr.map(n => (n.id === nodeId
      ? { ...n, variants: n.variants.map((v, i) => (i === (Number(n.active)||0) ? { ...v, next: nextNodeId ?? null } : v)) }
      : n))
  }

  // Rewire the pointers based on direction
  const newRootId = before ? rootId : (direction === 'up' ? current.nodeId : swap.nodeId)
  if (before) {
    setActiveNext(before.nodeId, direction === 'up' ? current.nodeId : swap.nodeId)
  }
  if (direction === 'up') {
    setActiveNext(current.nodeId, swap.nodeId)
    setActiveNext(swap.nodeId, after ? after.nodeId : null)
  } else {
    setActiveNext(swap.nodeId, current.nodeId)
    setActiveNext(current.nodeId, after ? after.nodeId : null)
  }

  return { nodes: arr, rootId: newRootId }
}

export function moveUp(nodes, rootId, messageId) {
  return moveMessage(nodes, rootId, messageId, 'up')
}

export function moveDown(nodes, rootId, messageId) {
  return moveMessage(nodes, rootId, messageId, 'down')
}
