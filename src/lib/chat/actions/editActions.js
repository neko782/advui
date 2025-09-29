// Edit actions: commit, replace, branch
import { buildVisible as _buildVisible, buildVisibleUpTo as _buildVisibleUpTo } from '../../branching.js'
import { findNodeByMessageId } from '../../utils/treeUtils.js'

export function commitEditReplace(nodes, editingId, editingText) {
  if (editingId == null) return nodes

  const val = String(editingText)
  return nodes.map(n => ({
    ...n,
    variants: (n.variants || []).map(v => (v.id === editingId ? { ...v, content: val, error: undefined } : v))
  }))
}

export function applyEditBranch(nodes, editingId, editingText, nextId) {
  if (editingId == null) return { nodes, nextId }

  const loc = findNodeByMessageId(nodes, editingId)
  const curNode = loc?.node
  const cur = curNode?.variants?.[loc.index]
  if (!curNode || !cur) return { nodes, nextId }

  const val = String(editingText)
  // Important: a branch should not inherit the existing variant's `next`.
  // Start a fresh path by clearing `next` on the new variant.
  const { next: _curNext, id: _curId, time: _curTime, typing: _curTyping, error: _curError, ...rest } = cur
  const newVariant = {
    ...rest,
    id: nextId,
    content: val,
    time: Date.now(),
    typing: false,
    error: undefined,
    next: null,
  }

  const updatedNodes = nodes.map(n => (
    n.id === curNode.id
      ? { ...n, variants: [...(n.variants || []), newVariant], active: (n.variants?.length || 0) }
      : n
  ))

  return { nodes: updatedNodes, nextId: nextId + 1 }
}

export function prepareBranchAndSend(nodes, rootId, editingId, editingText, nextId, nextNodeId) {
  if (editingId == null) return null

  const buildVisible = () => _buildVisible(nodes, rootId)
  const buildVisibleUpTo = (indexExclusive) => _buildVisibleUpTo(nodes, rootId, indexExclusive)

  const loc = findNodeByMessageId(nodes, editingId)
  const curNode = loc?.node
  const cur = curNode?.variants?.[loc.index]
  if (!curNode || !cur) return null

  const val = String(editingText)
  const branchIndex = Array.isArray(curNode?.variants) ? curNode.variants.length : 0

  // Special case: if nothing changed and this is the last visible message,
  // do not branch. For user messages, just generate the following reply.
  const path = buildVisible()
  const insertIndex = path.findIndex(vm => vm.nodeId === curNode.id)
  const isLast = insertIndex >= 0 && insertIndex === (path.length - 1)
  const noChange = (val === (cur.content || ''))
  if (noChange && isLast) {
    // No branching needed, just refresh after this message
    return {
      shouldRefreshOnly: true,
      insertIndex,
      nodes,
      nextId,
      nextNodeId
    }
  }

  // 1) Add a new variant and select it
  const { next: _prevNext, id: _prevId, time: _prevTime, typing: _prevTyping, error: _prevError, ...preserved } = cur
  const branched = {
    ...preserved,
    id: nextId,
    content: val,
    time: Date.now(),
    typing: false,
    error: undefined,
    next: null,
  }

  let updatedNodes = nodes.map(n => (
    n.id === curNode.id
      ? { ...n, variants: [...(n.variants || []), branched], active: branchIndex }
      : n
  ))

  // 2) Prepare typing node
  const typingMsg = {
    id: nextId + 1,
    role: 'assistant',
    content: 'typing',
    time: Date.now(),
    typing: true,
    error: undefined,
    next: null,
    reasoningSummary: '',
    reasoningSummaryLoading: true,
  }

  const typingNodeId = nextNodeId
  const typingNode = { id: typingNodeId, variants: [typingMsg], active: 0 }

  updatedNodes = updatedNodes.map(n => (
    n.id === curNode.id
      ? { ...n, variants: n.variants.map((v, i) => (i === branchIndex ? { ...v, next: typingNodeId } : v)) }
      : n
  ))
  updatedNodes = [...updatedNodes, typingNode]

  // 3) Build history for API call using updated nodes
  const buildVisibleUpdated = () => _buildVisible(updatedNodes, rootId)
  const buildVisibleUpToUpdated = (indexExclusive) => _buildVisibleUpTo(updatedNodes, rootId, indexExclusive)
  const pathForHistory = buildVisibleUpdated()
  const historyInsertIndex = pathForHistory.findIndex(vm => vm.nodeId === curNode.id)
  const history = buildVisibleUpToUpdated(historyInsertIndex + 1)
    .filter(m => !m.typing)
    .map(({ role, content }) => ({ role, content }))

  return {
    shouldRefreshOnly: false,
    nodes: updatedNodes,
    nextId: nextId + 2,
    nextNodeId: nextNodeId + 1,
    typingVariantId: typingMsg.id,
    history
  }
}