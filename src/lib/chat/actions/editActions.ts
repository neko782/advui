// Edit actions: commit, replace, branch, insert
import { buildVisible as _buildVisible, buildVisibleUpTo as _buildVisibleUpTo } from '../../branching.js';
import { findNodeByMessageId } from '../../utils/treeUtils.js';
import type { ChatNode, MessageVariant, BranchResult, BranchAndSendResult, HistoryMessage, InsertBetweenResult } from '../../types/index.js';

export function commitEditReplace(nodes: ChatNode[], editingId: number | null, editingText: string): ChatNode[] {
  if (editingId == null) return nodes;

  const val = String(editingText);
  return nodes.map(n => ({
    ...n,
    variants: (n.variants || []).map(v => (v.id === editingId ? { ...v, content: val, error: undefined } : v))
  }));
}

export function applyEditBranch(
  nodes: ChatNode[],
  editingId: number | null,
  editingText: string,
  nextId: number
): BranchResult {
  if (editingId == null) return { nodes, nextId };

  const loc = findNodeByMessageId(nodes, editingId);
  const curNode = loc?.node;
  const cur = curNode?.variants?.[loc.index];
  if (!curNode || !cur) return { nodes, nextId };

  const val = String(editingText);
  // Important: a branch should not inherit the existing variant's `next`.
  // Start a fresh path by clearing `next` on the new variant.
  const { next: _curNext, id: _curId, time: _curTime, typing: _curTyping, error: _curError, ...rest } = cur;
  const newVariant: MessageVariant = {
    ...rest,
    id: nextId,
    content: val,
    time: Date.now(),
    typing: false,
    error: undefined,
    next: null,
  };

  const updatedNodes = nodes.map(n => (
    n.id === curNode.id
      ? { ...n, variants: [...(n.variants || []), newVariant], active: (n.variants?.length || 0) }
      : n
  ));

  return { nodes: updatedNodes, nextId: nextId + 1 };
}

export function prepareBranchAndSend(
  nodes: ChatNode[],
  rootId: number | null,
  editingId: number | null,
  editingText: string,
  nextId: number,
  nextNodeId: number
): BranchAndSendResult | null {
  if (editingId == null) return null;

  const buildVisible = () => _buildVisible(nodes, rootId);
  const buildVisibleUpTo = (indexExclusive: number) => _buildVisibleUpTo(nodes, rootId, indexExclusive);

  const loc = findNodeByMessageId(nodes, editingId);
  const curNode = loc?.node;
  const cur = curNode?.variants?.[loc.index];
  if (!curNode || !cur) return null;

  const val = String(editingText);
  const branchIndex = Array.isArray(curNode?.variants) ? curNode.variants.length : 0;

  // Special case: if nothing changed and this is the last visible message,
  // do not branch. For user messages, just generate the following reply.
  const path = buildVisible();
  const insertIndex = path.findIndex(vm => vm.nodeId === curNode.id);
  const isLast = insertIndex >= 0 && insertIndex === (path.length - 1);
  const noChange = (val === (cur.content || ''));
  if (noChange && isLast) {
    // No branching needed, just refresh after this message
    return {
      shouldRefreshOnly: true,
      insertIndex,
      nodes,
      nextId,
      nextNodeId
    };
  }

  // 1) Add a new variant and select it
  const { next: _prevNext, id: _prevId, time: _prevTime, typing: _prevTyping, error: _prevError, ...preserved } = cur;
  const branched: MessageVariant = {
    ...preserved,
    id: nextId,
    content: val,
    time: Date.now(),
    typing: false,
    error: undefined,
    next: null,
  };

  let updatedNodes = nodes.map(n => (
    n.id === curNode.id
      ? { ...n, variants: [...(n.variants || []), branched], active: branchIndex }
      : n
  ));

  // 2) Prepare typing node
  const typingMsg: MessageVariant = {
    id: nextId + 1,
    role: 'assistant',
    content: 'typing',
    time: Date.now(),
    typing: true,
    error: undefined,
    next: null,
    reasoningSummary: '',
    reasoningSummaryLoading: true,
  };

  const typingNodeId = nextNodeId;
  const typingNode: ChatNode = { id: typingNodeId, variants: [typingMsg], active: 0 };

  updatedNodes = updatedNodes.map(n => (
    n.id === curNode.id
      ? { ...n, variants: n.variants.map((v, i) => (i === branchIndex ? { ...v, next: typingNodeId } : v)) }
      : n
  ));
  updatedNodes = [...updatedNodes, typingNode];

  // 3) Build history for API call using updated nodes
  const buildVisibleUpdated = () => _buildVisible(updatedNodes, rootId);
  const buildVisibleUpToUpdated = (indexExclusive: number) => _buildVisibleUpTo(updatedNodes, rootId, indexExclusive);
  const pathForHistory = buildVisibleUpdated();
  const historyInsertIndex = pathForHistory.findIndex(vm => vm.nodeId === curNode.id);
  const history: HistoryMessage[] = buildVisibleUpToUpdated(historyInsertIndex + 1)
    .filter(m => !m.typing)
    .map(({ role, content }) => ({ role, content }));

  return {
    shouldRefreshOnly: false,
    nodes: updatedNodes,
    nextId: nextId + 2,
    nextNodeId: nextNodeId + 1,
    typingVariantId: typingMsg.id,
    history
  };
}

/**
 * Insert an empty user message after the message at the given index.
 * This inserts seamlessly into the current branch by:
 * 1. Updating the parent's active variant's `next` to point to the new node
 * 2. Setting the new node's `next` to point to what was previously the child
 *
 * @param nodes - Current chat nodes
 * @param rootId - Root node ID
 * @param afterIndex - Index in the visible path after which to insert
 * @param nextId - Next available message variant ID
 * @param nextNodeId - Next available node ID
 * @returns InsertBetweenResult with updated nodes and IDs, or null if invalid
 */
export function insertMessageBetween(
  nodes: ChatNode[],
  rootId: number | null,
  afterIndex: number,
  nextId: number,
  nextNodeId: number
): InsertBetweenResult | null {
  const buildVisible = () => _buildVisible(nodes, rootId);
  const path = buildVisible();

  // Validate the index
  if (afterIndex < 0 || afterIndex >= path.length) {
    return null;
  }

  const parentVm = path[afterIndex];
  if (!parentVm) return null;

  const parentNodeId = parentVm.nodeId;
  const parentNode = nodes.find(n => n.id === parentNodeId);
  if (!parentNode) return null;

  // Get the current active variant from the parent
  const activeIndex = Math.max(0, Math.min((parentNode.variants?.length || 1) - 1, Number(parentNode.active) || 0));
  const activeVariant = parentNode.variants[activeIndex];
  if (!activeVariant) return null;

  // Get the existing next node ID (what the parent currently points to)
  const existingNextNodeId = activeVariant.next;

  // Create the new empty user message that points to the existing child
  const newMsg: MessageVariant = {
    id: nextId,
    role: 'user',
    content: '',
    time: Date.now(),
    typing: false,
    error: undefined,
    next: existingNextNodeId,  // Point to what was the child
  };

  // Create the new node
  const newNode: ChatNode = {
    id: nextNodeId,
    variants: [newMsg],
    active: 0,
  };

  // Update the parent's active variant to point to the new node
  let updatedNodes = nodes.map(n => (
    n.id === parentNodeId
      ? {
          ...n,
          variants: n.variants.map((v, i) =>
            i === activeIndex ? { ...v, next: newNode.id } : v
          )
        }
      : n
  ));

  // Add the new node
  updatedNodes = [...updatedNodes, newNode];

  return {
    nodes: updatedNodes,
    nextId: nextId + 1,
    nextNodeId: nextNodeId + 1,
    insertedNodeId: newNode.id,
    insertedMessageId: newMsg.id,
  };
}

