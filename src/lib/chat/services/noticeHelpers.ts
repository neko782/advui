// Notice computation helpers
import { validateTree, buildVisible } from '../../branching.js';
import { BUG_NOTICE, DEBUG_AUTOFIX_NOTICE } from '../../constants/index.js';
import type { Node, VisibleMessage } from '../../types/index.js';

export function computeValidationNotice(
  nodes: Node[],
  rootId: number | null,
  debug: boolean
): string {
  try {
    const result = validateTree(nodes, rootId);
    if (!result.ok && result.problems.length > 0) {
      const problemsStr = result.problems.slice(0, 3).join('; ');
      const more = result.problems.length > 3 ? `… and ${result.problems.length - 3} more` : '';
      if (debug) {
        return `[Debug] Graph issues: ${problemsStr}${more}. ${DEBUG_AUTOFIX_NOTICE}`;
      }
      return `Graph issues: ${problemsStr}${more}. ${BUG_NOTICE}`;
    }
  } catch {
    // Ignore errors
  }
  return '';
}

export function computeGenerationNotice(nodes: Node[], rootId: number | null): string {
  try {
    const visible = buildVisible(nodes, rootId);
    const last = visible[visible.length - 1];
    if (last?.m?.error) {
      const error = last.m.error;
      if (error.startsWith('Error:')) {
        return error;
      }
      return `Error: ${error}`;
    }
  } catch {
    // Ignore errors
  }
  return '';
}

export function assembleNotice(
  generationNotice: string | null | undefined,
  sanitizerNotice: string | null | undefined,
  validationNotice: string | null | undefined,
  missingApiKeyNotice: string | null | undefined,
  dismissedNotice: string
): string {
  const parts: string[] = [];
  if (generationNotice) parts.push(generationNotice);
  if (sanitizerNotice) parts.push(sanitizerNotice);
  if (validationNotice) parts.push(validationNotice);
  if (missingApiKeyNotice) parts.push(missingApiKeyNotice);
  const assembled = parts.join(' ');
  if (assembled === dismissedNotice) {
    return '';
  }
  return assembled;
}

export interface FollowingInfo {
  has: boolean;
  id: number | null;
  typing: boolean;
}

export function computeFollowingMap(
  nodes: Node[],
  rootId: number | null
): Record<number, FollowingInfo> {
  const map: Record<number, FollowingInfo> = {};
  try {
    const visible = buildVisible(nodes, rootId);
    for (let i = 0; i < visible.length; i++) {
      const vm = visible[i];
      if (!vm) continue;
      const next = visible[i + 1];
      
      if (next && next.m?.role === 'assistant') {
        map[i] = {
          has: true,
          id: next.m.id,
          typing: !!next.m.typing,
        };
      } else {
        map[i] = {
          has: false,
          id: null,
          typing: false,
        };
      }
    }
  } catch {
    // Ignore errors
  }
  return map;
}
