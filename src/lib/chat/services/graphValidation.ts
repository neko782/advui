// Graph validation and sanitization
import { validateTree, enforceUniqueParents, enforceUniqueParentsWithInfo, normalizeNodesActive, validateRootId } from '../../branching.js';
import { BUG_NOTICE, DEBUG_AUTOFIX_NOTICE } from '../../constants/index.js';
import type { ChatNode, SanitizedGraphResult } from '../../types/index.js';

export { validateTree, enforceUniqueParents, enforceUniqueParentsWithInfo };

/**
 * Extended result with detailed mutation info
 */
export interface DetailedSanitizedResult extends SanitizedGraphResult {
  mutations: {
    activeIndexNormalized: boolean;
    rootIdCorrected: boolean;
    edgesCleared: number;
    clearedEdgeDetails: Array<{ fromNodeId: number; variantIndex: number; toNodeId: number }>;
  };
}

export function sanitizeGraphIfNeeded(
  nodes: ChatNode[],
  rootId: number | null,
  debug: boolean
): SanitizedGraphResult {
  if (debug) return { nodes, notice: '' }; // allow broken graphs in debug mode

  try {
    const check = validateTree(nodes, rootId);
    if (check?.details?.multipleParents && check.details.multipleParents.size > 0) {
      // Record a user-facing notice before mutating
      let notice = '';
      try {
        const ids = [...check.details.multipleParents.keys()];
        const sample = ids.slice(0, 5).join(', ');
        const more = ids.length > 5 ? '…' : '';
        notice = `Auto-fixed chat structure issue: multiple parents detected for node(s) ${sample}${more}. ${BUG_NOTICE}`;
      } catch {
        notice = `Auto-fixed chat structure issue: multiple parents detected. ${BUG_NOTICE}`;
      }
      const sanitized = enforceUniqueParents(nodes, rootId);
      return { nodes: sanitized, notice };
    }
  } catch {
    // Ignore validation errors
  }

  return { nodes, notice: '' };
}

/**
 * Comprehensive graph sanitization with detailed mutation tracking.
 * Fixes:
 * - Active indices out of bounds
 * - Invalid rootId
 * - Multiple parents (merge points)
 */
export function sanitizeGraphComprehensive(
  nodes: ChatNode[],
  rootId: number | null,
  debug: boolean
): DetailedSanitizedResult {
  if (debug) {
    return {
      nodes,
      notice: '',
      mutations: {
        activeIndexNormalized: false,
        rootIdCorrected: false,
        edgesCleared: 0,
        clearedEdgeDetails: [],
      },
    };
  }

  const notices: string[] = [];
  let currentNodes = nodes;
  let currentRootId = rootId;
  let activeNormalized = false;
  let rootCorrected = false;
  let clearedEdges: Array<{ fromNodeId: number; variantIndex: number; toNodeId: number }> = [];

  try {
    // Step 1: Normalize active indices
    const normalizedNodes = normalizeNodesActive(currentNodes);
    if (normalizedNodes !== currentNodes) {
      activeNormalized = true;
      currentNodes = normalizedNodes;
    }

    // Step 2: Validate and fix rootId
    const rootValidation = validateRootId(currentNodes, currentRootId);
    if (rootValidation.corrected) {
      rootCorrected = true;
      currentRootId = rootValidation.rootId;
      notices.push('Root node was corrected');
    }

    // Step 3: Fix multiple parents
    const check = validateTree(currentNodes, currentRootId);
    if (check?.details?.multipleParents && check.details.multipleParents.size > 0) {
      const result = enforceUniqueParentsWithInfo(currentNodes, currentRootId);
      currentNodes = result.nodes;
      clearedEdges = result.clearedEdges;

      if (result.mutated) {
        const ids = [...check.details.multipleParents.keys()];
        const sample = ids.slice(0, 5).join(', ');
        const more = ids.length > 5 ? '…' : '';
        notices.push(`Multiple parents fixed for node(s) ${sample}${more}`);
      }
    }
  } catch {
    // Ignore validation errors, return what we have
  }

  const notice = notices.length > 0
    ? `Auto-fixed: ${notices.join('; ')}. ${BUG_NOTICE}`
    : '';

  return {
    nodes: currentNodes,
    notice,
    mutations: {
      activeIndexNormalized: activeNormalized,
      rootIdCorrected: rootCorrected,
      edgesCleared: clearedEdges.length,
      clearedEdgeDetails: clearedEdges,
    },
  };
}

