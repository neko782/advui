// Legacy migration: flatten old graph-based messages + selection into nodes with single variants
import type { ChatNode, MessageVariant, MessageRole } from '../../types/index.js';

interface LegacyMessage {
  id: number;
  role: string;
  content: string;
  time?: number;
  typing?: boolean;
  error?: string;
  next?: number[];
}

interface MigrationResult {
  nodes: ChatNode[];
  rootId: number | null;
}

export function migrateLegacyGraphToNodes(
  messagesArr: LegacyMessage[],
  legacyRootId: number | null | undefined,
  legacySelected: Record<number, number> | null | undefined
): MigrationResult {
  const msgs = Array.isArray(messagesArr) ? messagesArr.slice() : [];
  const byId = new Map(msgs.map(m => [m.id, m]));
  const outNodes: ChatNode[] = [];
  let nid = 1;
  const nodeIdByMsgId = new Map<number, number>();
  const now = Date.now();

  for (const m of msgs) {
    const nodeId = nid++;
    nodeIdByMsgId.set(m.id, nodeId);
    outNodes.push({
      id: nodeId,
      variants: [{
        id: m.id,
        role: m.role as MessageRole,
        content: m.content,
        time: m.time || now,
        typing: !!m.typing,
        error: m.error,
        next: null
      }],
      active: 0
    });
  }

  // Wire next pointers along selected branches
  for (const m of msgs) {
    const children = Array.isArray(m.next) ? m.next : [];
    if (!children.length) continue;
    const sel = Math.max(0, Math.min(children.length - 1, Number(legacySelected?.[m.id]) || 0));
    const childMsgId = children[sel];
    if (childMsgId === undefined) continue;
    const fromNodeId = nodeIdByMsgId.get(m.id);
    const toNodeId = nodeIdByMsgId.get(childMsgId);
    const node = outNodes.find(n => n.id === fromNodeId);
    if (node && toNodeId != null) {
      node.variants = node.variants.map((v, i) => (i === 0 ? { ...v, next: toNodeId } : v));
    }
  }

  const root = (legacyRootId != null) ? nodeIdByMsgId.get(legacyRootId) : (outNodes[0]?.id || 1);
  return { nodes: outNodes, rootId: root ?? null };
}

