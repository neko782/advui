import { buildVisible, validateTree } from '../../branching.js';
import { BUG_NOTICE } from '../../constants/index.js';
import type { ChatNode, TreeValidationResult } from '../../types/index.js';

export interface ChatEditState {
  nodes: ChatNode[];
  rootId: number | null;
  nextId?: number;
  nextNodeId?: number;
}

export interface ValidateChatEditOptions {
  label?: string;
  allowDelete?: boolean;
  debug?: boolean;
  requireVisibleVariantIds?: number[] | (() => number[]);
}

export interface ValidateChatEditResult {
  ok: boolean;
  notice: string;
  validation?: TreeValidationResult;
  missingNodeIds: number[];
  missingVariantIds: number[];
  missingVisibleVariantIds: number[];
}

function collectIds(nodes: ChatNode[]): { nodeIds: Set<number>; variantIds: Set<number> } {
  const nodeIds = new Set<number>();
  const variantIds = new Set<number>();

  for (const node of nodes || []) {
    const nodeId = Number((node as { id?: unknown })?.id);
    if (Number.isFinite(nodeId)) nodeIds.add(nodeId);
    const variants = Array.isArray(node?.variants) ? node.variants : [];
    for (const variant of variants) {
      const variantId = Number((variant as { id?: unknown })?.id);
      if (Number.isFinite(variantId)) variantIds.add(variantId);
    }
  }

  return { nodeIds, variantIds };
}

function diffMissing(before: Set<number>, after: Set<number>): number[] {
  const missing: number[] = [];
  for (const id of before) {
    if (!after.has(id)) missing.push(id);
  }
  return missing;
}

export function validateChatEdit(
  before: ChatEditState,
  after: ChatEditState,
  options: ValidateChatEditOptions = {}
): ValidateChatEditResult {
  const label = options.label || 'edit';
  const allowDelete = !!options.allowDelete;
  const debug = !!options.debug;
  const requireVisibleVariantIds = (() => {
    const raw = options.requireVisibleVariantIds;
    if (typeof raw === 'function') return raw();
    return Array.isArray(raw) ? raw : [];
  })();

  const beforeNodes = Array.isArray(before?.nodes) ? before.nodes : [];
  const afterNodes = Array.isArray(after?.nodes) ? after.nodes : [];

  const beforeIds = collectIds(beforeNodes);
  const afterIds = collectIds(afterNodes);

  const missingNodeIds = allowDelete ? [] : diffMissing(beforeIds.nodeIds, afterIds.nodeIds);
  const missingVariantIds = allowDelete ? [] : diffMissing(beforeIds.variantIds, afterIds.variantIds);

  const missingVisibleVariantIds: number[] = [];
  if (requireVisibleVariantIds.length > 0) {
    try {
      const visible = buildVisible(afterNodes, after?.rootId ?? null);
      const visibleIds = new Set<number>(visible.map(vm => Number(vm?.m?.id)).filter(Number.isFinite));
      for (const id of requireVisibleVariantIds) {
        const num = Number(id);
        if (!Number.isFinite(num)) continue;
        if (!visibleIds.has(num)) missingVisibleVariantIds.push(num);
      }
    } catch {
      // If visibility traversal fails, treat as missing
      for (const id of requireVisibleVariantIds) {
        const num = Number(id);
        if (Number.isFinite(num)) missingVisibleVariantIds.push(num);
      }
    }
  }

  if (missingNodeIds.length || missingVariantIds.length) {
    const parts: string[] = [];
    if (missingVariantIds.length) parts.push(`message(s) ${missingVariantIds.slice(0, 5).join(', ')}${missingVariantIds.length > 5 ? '…' : ''}`);
    if (missingNodeIds.length) parts.push(`node(s) ${missingNodeIds.slice(0, 5).join(', ')}${missingNodeIds.length > 5 ? '…' : ''}`);
    const what = parts.join(' and ');
    return {
      ok: false,
      notice: `Reverted ${label}: it would delete ${what} without an explicit delete. ${BUG_NOTICE}`,
      missingNodeIds,
      missingVariantIds,
      missingVisibleVariantIds,
    };
  }

  if (missingVisibleVariantIds.length) {
    return {
      ok: false,
      notice: `Reverted ${label}: it would hide message(s) ${missingVisibleVariantIds.slice(0, 5).join(', ')}${missingVisibleVariantIds.length > 5 ? '…' : ''}. ${BUG_NOTICE}`,
      missingNodeIds,
      missingVariantIds,
      missingVisibleVariantIds,
    };
  }

  if (!debug) {
    try {
      const validation = validateTree(afterNodes, after?.rootId ?? null);
      if (!validation.ok) {
        const problemsStr = validation.problems.slice(0, 3).join('; ');
        const more = validation.problems.length > 3 ? `… and ${validation.problems.length - 3} more` : '';
        return {
          ok: false,
          notice: `Reverted ${label}: it would corrupt the chat graph (${problemsStr}${more}). ${BUG_NOTICE}`,
          validation,
          missingNodeIds,
          missingVariantIds,
          missingVisibleVariantIds,
        };
      }
      return {
        ok: true,
        notice: '',
        validation,
        missingNodeIds,
        missingVariantIds,
        missingVisibleVariantIds,
      };
    } catch {
      return {
        ok: false,
        notice: `Reverted ${label}: graph validation failed. ${BUG_NOTICE}`,
        missingNodeIds,
        missingVariantIds,
        missingVisibleVariantIds,
      };
    }
  }

  return {
    ok: true,
    notice: '',
    missingNodeIds,
    missingVariantIds,
    missingVisibleVariantIds,
  };
}

