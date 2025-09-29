// Tree/node traversal utilities for chat branching structure

/**
 * Finds a node and variant index by message ID
 * @param {Array} nodes - Array of tree nodes
 * @param {string|number} mid - Message ID to search for
 * @returns {{node: Object|null, index: number}} Object containing the node and variant index
 */
export function findNodeByMessageId(nodes, mid) {
  for (const n of nodes || []) {
    const i = (n?.variants || []).findIndex(v => v?.id === mid)
    if (i >= 0) return { node: n, index: i }
  }
  return { node: null, index: -1 }
}