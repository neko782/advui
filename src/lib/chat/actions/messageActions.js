// Message manipulation actions: delete, role change, move up/down
import { VALID_MESSAGE_ROLES } from '../../constants/index.js'
import { buildVisible as _buildVisible } from '../../branching.js'
import { findNodeByMessageId } from '../../utils/treeUtils.js'

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