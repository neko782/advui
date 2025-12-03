import { deepClone } from './utils/immutable.js';
import type {
  ChatNode,
  MessageVariant,
  VisibleMessage,
  TreeValidationResult,
  TreeValidationDetails,
  IncomingEdge
} from './types/index.js';

// Branching helpers: node-based conversation graph.
// New architecture:
// - nodes: array of { id, variants: Message[], active?: number }
// - A "Message" (aka variant) is { id, role, content, time, typing?, error?, next?: number|null }
// - Each variant has at most one `next` (points to the id of the next node)
// - Each node chooses its active variant via `active` (default 0)

export function indexNodesById(nodes: ChatNode[]): Map<number, ChatNode> {
  const map = new Map<number, ChatNode>();
  for (const n of nodes || []) map.set(n.id, n);
  return map;
}

/**
 * Ensures the active index is within bounds for a node's variants.
 * Returns the clamped index.
 */
export function clampActiveIndex(node: ChatNode): number {
  const variants = Array.isArray(node?.variants) ? node.variants : [];
  const len = variants.length;
  if (len === 0) return 0;
  const raw = Number(node?.active) || 0;
  return Math.max(0, Math.min(len - 1, raw));
}

/**
 * Normalizes a node to ensure active is within bounds.
 * Returns the same node if no changes needed, or a new node object.
 */
export function normalizeNodeActive(node: ChatNode): ChatNode {
  const clamped = clampActiveIndex(node);
  const current = Number(node?.active) || 0;
  if (clamped === current) return node;
  return { ...node, active: clamped };
}

/**
 * Normalizes all nodes in an array to ensure active indices are valid.
 */
export function normalizeNodesActive(nodes: ChatNode[]): ChatNode[] {
  if (!Array.isArray(nodes)) return [];
  let mutated = false;
  const result = nodes.map(n => {
    const normalized = normalizeNodeActive(n);
    if (normalized !== n) mutated = true;
    return normalized;
  });
  return mutated ? result : nodes;
}

/**
 * Validates that a rootId points to a node with no incoming edges.
 * Returns the validated rootId or a corrected one.
 */
export function validateRootId(nodes: ChatNode[], rootId: number | null): { rootId: number | null; corrected: boolean } {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { rootId: null, corrected: rootId !== null };
  }

  const byId = indexNodesById(nodes);
  const allNodeIds = new Set(byId.keys());

  // Build incoming edges map
  const hasIncoming = new Set<number>();
  for (const n of nodes) {
    for (const v of n?.variants || []) {
      const tgt = v?.next;
      if (tgt != null && allNodeIds.has(Number(tgt))) {
        hasIncoming.add(Number(tgt));
      }
    }
  }

  // If rootId is valid and has no incoming edges, it's good
  if (rootId != null && allNodeIds.has(Number(rootId)) && !hasIncoming.has(Number(rootId))) {
    return { rootId, corrected: false };
  }

  // Find a valid root (node with no incoming edges)
  for (const n of nodes) {
    if (!hasIncoming.has(n.id)) {
      return { rootId: n.id, corrected: true };
    }
  }

  // Fallback to first node (shouldn't happen in valid trees)
  return { rootId: nodes[0]?.id ?? null, corrected: true };
}

export function buildVisible(nodes: ChatNode[], rootId: number | null): VisibleMessage[] {
  const byId = indexNodesById(nodes);
  const out: VisibleMessage[] = [];
  let curId = rootId;
  let pathIndex = 0;
  const guard = new Set<number>();
  while (curId != null) {
    const node = byId.get(curId);
    if (!node || guard.has(curId)) break;
    guard.add(curId);
    const variants = Array.isArray(node.variants) ? node.variants : [];
    const vi = clampActiveIndex(node);
    const m = variants[vi];
    if (!m) break;
    out.push({ m, i: pathIndex, nodeId: node.id, variantIndex: vi, variantsLength: variants.length });
    pathIndex++;
    const nxt = (m && m.next != null) ? m.next : null;
    curId = nxt;
  }
  return out;
}

export function buildVisibleUpTo(nodes: ChatNode[], rootId: number | null, indexExclusive: number): MessageVariant[] {
  const full = buildVisible(nodes, rootId);
  const upto = Math.max(0, Math.min(indexExclusive ?? 0, full.length));
  return full.slice(0, upto).map(vm => vm.m);
}

export function findParentId(nodes: ChatNode[], childNodeId: number): number | null {
  for (const n of nodes || []) {
    const variants = Array.isArray(n.variants) ? n.variants : [];
    if (variants.some(v => v?.next === childNodeId)) return n.id;
  }
  return null;
}

// Validate that the node/variant graph forms a tree (no merges, no cycles)
// and that no two messages (variants) lead to the same node.
// Returns a summary with problems suitable for user notification.
export function validateTree(nodes: ChatNode[], rootId: number | null): TreeValidationResult {
  const problems: string[] = [];
  const details: TreeValidationDetails = {
    duplicateNodeIds: [],
    multipleParents: new Map(),
    missingTargets: new Set(),
    cycles: [],
    multipleRoots: [],
    rootHasParent: false,
    unreachableFromRoot: new Set(),
  };

  // Basic presence
  const list = Array.isArray(nodes) ? nodes : [];
  const idCounts = new Map<number, number>();
  for (const n of list) {
    const id = Number(n?.id);
    if (!Number.isFinite(id)) continue;
    idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }
  for (const [id, c] of idCounts.entries()) if (c > 1) details.duplicateNodeIds.push(id);
  if (details.duplicateNodeIds.length) problems.push(`Duplicate node ids: ${details.duplicateNodeIds.join(', ')}`);

  const byId = indexNodesById(list);
  const allNodeIds = new Set(byId.keys());

  // Build incoming edges map; record missing targets
  const incoming = new Map<number, IncomingEdge[]>();
  for (const n of list) {
    const variants = Array.isArray(n?.variants) ? n.variants : [];
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const tgt = (v && v.next != null) ? Number(v.next) : null;
      if (tgt == null) continue;
      if (!allNodeIds.has(tgt)) { details.missingTargets.add(tgt); continue; }
      const arr = incoming.get(tgt) || [];
      arr.push({ fromNodeId: Number(n.id), variantIndex: i, variantId: Number(v!.id) });
      incoming.set(tgt, arr);
    }
  }
  if (details.missingTargets.size) problems.push(`Broken links to missing nodes: ${[...details.missingTargets].join(', ')}`);

  // No two messages should lead to the same node => incoming count <= 1 per node
  for (const [tgt, arr] of incoming.entries()) {
    if (arr.length > 1) details.multipleParents.set(tgt, arr);
  }
  if (details.multipleParents.size) {
    const sample = [...details.multipleParents.keys()].slice(0, 5);
    problems.push(`Merge detected: multiple parents for node(s) ${sample.join(', ')}${details.multipleParents.size > 5 ? '…' : ''}`);
  }

  // Root checks
  const indegree0 = [...allNodeIds].filter(id => (incoming.get(id)?.length || 0) === 0);
  // If specified rootId is non-null, it should be a node and have indegree 0
  if (rootId != null && allNodeIds.size) {
    if (!allNodeIds.has(Number(rootId))) {
      problems.push(`Root id ${rootId} not found among nodes`);
    } else if ((incoming.get(Number(rootId))?.length || 0) > 0) {
      details.rootHasParent = true;
      problems.push('Root node has an incoming link (should have none)');
    }
  }
  // Multiple roots (more than one indegree-0 node)
  if (indegree0.length > 1) {
    details.multipleRoots = indegree0;
    problems.push(`Multiple roots detected: ${indegree0.slice(0, 5).join(', ')}${indegree0.length > 5 ? '…' : ''}`);
  }

  // Cycle detection on the union graph of all variants' next edges
  const adj = new Map<number, Set<number>>();
  for (const id of allNodeIds) adj.set(id, new Set());
  for (const n of list) {
    const from = Number(n?.id);
    for (const v of (n?.variants || [])) {
      const t = (v && v.next != null) ? Number(v.next) : null;
      if (t != null && allNodeIds.has(t)) adj.get(from)!.add(t);
    }
  }
  const color = new Map<number, number>(); // 0=unseen,1=visiting,2=done
  for (const id of allNodeIds) color.set(id, 0);
  const stack: number[] = [];
  function dfs(u: number): void {
    color.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) || []) {
      const c = color.get(v) || 0;
      if (c === 0) { dfs(v); }
      else if (c === 1) {
        // found a cycle; record path from v to end of stack
        const start = stack.indexOf(v);
        if (start >= 0) details.cycles.push(stack.slice(start).concat(v));
      }
    }
    stack.pop();
    color.set(u, 2);
  }
  for (const id of allNodeIds) if ((color.get(id) || 0) === 0) dfs(id);
  if (details.cycles.length) problems.push('Cycle detected in conversation graph');

  // Reachability from root across all edges
  const reachable = new Set<number>();
  if (rootId != null && allNodeIds.has(Number(rootId))) {
    const q: number[] = [Number(rootId)];
    while (q.length) {
      const u = q.shift()!;
      if (reachable.has(u)) continue;
      reachable.add(u);
      for (const v of adj.get(u) || []) q.push(v);
    }
  }
  for (const id of allNodeIds) if (!reachable.has(id)) details.unreachableFromRoot.add(id);
  if (details.unreachableFromRoot.size && allNodeIds.size) {
    const sample = [...details.unreachableFromRoot].slice(0, 5);
    problems.push(`Nodes detached from root: ${sample.join(', ')}${details.unreachableFromRoot.size > 5 ? '…' : ''}`);
  }

  return { ok: problems.length === 0, problems, details };
}

/**
 * Result of enforcing unique parents, including mutation details
 */
export interface EnforceUniqueParentsResult {
  nodes: ChatNode[];
  mutated: boolean;
  clearedEdges: Array<{ fromNodeId: number; variantIndex: number; toNodeId: number }>;
}

// Enforce the invariant: each node has at most one parent (incoming edge).
// If multiple variants point to the same target node, keep one and null out the rest.
// Preference order for which incoming edge to keep:
//   1) The edge that lies on the visible path from root (active variants)
//   2) Otherwise, the first encountered incoming edge
// Returns detailed info about what was changed.
export function enforceUniqueParentsWithInfo(nodes: ChatNode[], rootId: number | null): EnforceUniqueParentsResult {
  const list = Array.isArray(nodes)
    ? deepClone(nodes)
    : [];
  if (!list.length) return { nodes: list, mutated: false, clearedEdges: [] };

  const byId = new Map(list.map(n => [Number(n?.id), n]));
  const allNodeIds = new Set(byId.keys());
  const clearedEdges: Array<{ fromNodeId: number; variantIndex: number; toNodeId: number }> = [];

  // Build incoming edges: tgt -> [{ nodeId, variantIndex }]
  const incoming = new Map<number, Array<{ nodeId: number; variantIndex: number }>>();
  for (const n of list) {
    const fromId = Number(n?.id);
    const variants = Array.isArray(n?.variants) ? n.variants : [];
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const t = (v && v.next != null) ? Number(v.next) : null;
      if (t == null || !allNodeIds.has(t)) continue;
      const arr = incoming.get(t) || [];
      arr.push({ nodeId: fromId, variantIndex: i });
      incoming.set(t, arr);
    }
  }

  // Compute preferred edges from visible path
  const keepEdges = new Set<string>();
  if (rootId != null && allNodeIds.has(Number(rootId))) {
    let cur: number | null = Number(rootId);
    const guard = new Set<number>();
    while (cur != null && !guard.has(cur)) {
      guard.add(cur);
      const node = byId.get(cur);
      if (!node) break;
      const vi = clampActiveIndex(node);
      const variants = Array.isArray(node.variants) ? node.variants : [];
      const m = variants[vi];
      if (!m) break;
      const nxt = (m && m.next != null) ? Number(m.next) : null;
      if (nxt == null) break;
      keepEdges.add(`${node.id}->${nxt}`);
      cur = nxt;
    }
  }

  // For targets with multiple parents, keep one; clear others.
  for (const [tgt, arr] of incoming.entries()) {
    if (!Array.isArray(arr) || arr.length <= 1) continue;
    let keep: { nodeId: number; variantIndex: number } | null = null;
    for (const r of arr) {
      if (keepEdges.has(`${r.nodeId}->${tgt}`)) { keep = r; break; }
    }
    if (!keep) keep = arr[0]!;
    for (const r of arr) {
      if (r.nodeId === keep.nodeId && r.variantIndex === keep.variantIndex) continue;
      const n = byId.get(r.nodeId);
      if (!n) continue;
      const v = (n.variants || [])[r.variantIndex];
      if (!v) continue;
      n.variants[r.variantIndex] = { ...v, next: null };
      clearedEdges.push({ fromNodeId: r.nodeId, variantIndex: r.variantIndex, toNodeId: tgt });
    }
  }

  return {
    nodes: [...byId.values()],
    mutated: clearedEdges.length > 0,
    clearedEdges,
  };
}

/**
 * Legacy wrapper that returns just the nodes array for backwards compatibility
 */
export function enforceUniqueParents(nodes: ChatNode[], rootId: number | null): ChatNode[] {
  return enforceUniqueParentsWithInfo(nodes, rootId).nodes;
}


