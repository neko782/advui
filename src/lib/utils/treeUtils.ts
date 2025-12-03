// Tree/node traversal utilities for chat branching structure
import type { ChatNode, NodeLocation } from '../types/index.js';

/**
 * Finds a node and variant index by message ID
 */
export function findNodeByMessageId(nodes: ChatNode[], mid: number): NodeLocation {
  for (const n of nodes || []) {
    const i = (n?.variants || []).findIndex(v => v?.id === mid);
    if (i >= 0) return { node: n, index: i };
  }
  return { node: null, index: -1 };
}

