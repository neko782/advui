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
  const now = Date.now();

  if (!msgs.length) return { nodes: [], rootId: null };

  const toVariant = (m: LegacyMessage): MessageVariant => ({
    id: m.id,
    role: m.role as MessageRole,
    content: m.content,
    time: m.time || now,
    typing: !!m.typing,
    error: m.error,
    next: null
  });

  // Determine the root message: prefer the stored legacy root, otherwise
  // fall back to the first message with no parent, then the first message.
  const hasParent = new Set<number>();
  for (const m of msgs) {
    for (const c of (Array.isArray(m.next) ? m.next : [])) hasParent.add(c);
  }
  const rootMsg = (legacyRootId != null && byId.has(legacyRootId))
    ? byId.get(legacyRootId)!
    : (msgs.find(m => !hasParent.has(m.id)) || msgs[0]!);

  // Legacy sibling branches (a message's `next` children + selected index)
  // become variants of a single node in the new model. Walk iteratively so
  // very long chats don't overflow the stack.
  const visitedMsgIds = new Set<number>();
  const rootNodeId = nid++;
  outNodes.push({ id: rootNodeId, variants: [toVariant(rootMsg)], active: 0 });
  visitedMsgIds.add(rootMsg.id);

  // Each stack entry pairs a created node with the legacy messages backing its variants
  const stack: Array<{ node: ChatNode; msgIds: number[] }> = [
    { node: outNodes[0]!, msgIds: [rootMsg.id] }
  ];

  while (stack.length) {
    const { node, msgIds } = stack.pop()!;
    for (let vi = 0; vi < msgIds.length; vi++) {
      const m = byId.get(msgIds[vi]!);
      if (!m) continue;
      const children = (Array.isArray(m.next) ? m.next : [])
        .filter(cid => byId.has(cid) && !visitedMsgIds.has(cid));
      if (!children.length) continue;
      for (const cid of children) visitedMsgIds.add(cid);

      const rawSel = Number(legacySelected?.[m.id]) || 0;
      const sel = Math.max(0, Math.min(children.length - 1, Math.floor(rawSel)));
      const childNode: ChatNode = {
        id: nid++,
        variants: children.map(cid => toVariant(byId.get(cid)!)),
        active: sel
      };
      outNodes.push(childNode);
      node.variants = node.variants.map((v, i) => (i === vi ? { ...v, next: childNode.id } : v));
      stack.push({ node: childNode, msgIds: children });
    }
  }

  return { nodes: outNodes, rootId: rootNodeId };
}

