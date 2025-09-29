// Legacy migration: flatten old graph-based messages + selection into nodes with single variants

export function migrateLegacyGraphToNodes(messagesArr, legacyRootId, legacySelected) {
  const msgs = Array.isArray(messagesArr) ? messagesArr.slice() : []
  const byId = new Map(msgs.map(m => [m.id, m]))
  const outNodes = []
  let nid = 1
  const nodeIdByMsgId = new Map()
  const now = Date.now()

  for (const m of msgs) {
    const nodeId = nid++
    nodeIdByMsgId.set(m.id, nodeId)
    outNodes.push({
      id: nodeId,
      variants: [{
        id: m.id,
        role: m.role,
        content: m.content,
        time: m.time || now,
        typing: !!m.typing,
        error: m.error,
        next: null
      }],
      active: 0
    })
  }

  // Wire next pointers along selected branches
  for (const m of msgs) {
    const children = Array.isArray(m.next) ? m.next : []
    if (!children.length) continue
    const sel = Math.max(0, Math.min(children.length - 1, Number(legacySelected?.[m.id]) || 0))
    const childMsgId = children[sel]
    const fromNodeId = nodeIdByMsgId.get(m.id)
    const toNodeId = nodeIdByMsgId.get(childMsgId)
    const node = outNodes.find(n => n.id === fromNodeId)
    if (node && toNodeId != null) {
      node.variants = node.variants.map((v, i) => (i === 0 ? { ...v, next: toNodeId } : v))
    }
  }

  const root = (legacyRootId != null) ? nodeIdByMsgId.get(legacyRootId) : (outNodes[0]?.id || 1)
  return { nodes: outNodes, rootId: root }
}