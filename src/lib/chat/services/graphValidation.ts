// Graph validation and sanitization
import { validateTree, enforceUniqueParents } from '../../branching.js';
import { BUG_NOTICE, DEBUG_AUTOFIX_NOTICE } from '../../constants/index.js';
import type { ChatNode, SanitizedGraphResult } from '../../types/index.js';

export { validateTree, enforceUniqueParents };

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

