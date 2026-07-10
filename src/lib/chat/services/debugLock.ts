// Debug-lock helpers: mark/unmark all nodes and variants as locked/typing
// (debug tooling for simulating a locked chat).
import type { ChatNode, MessageVariant } from '../../types/index.js';

function applyDebugLockToVariants(list: MessageVariant[]): MessageVariant[] {
  if (!Array.isArray(list)) return list;
  return list.map((variant) => {
    if (!variant || typeof variant !== 'object') return variant;
    return {
      ...variant,
      locked: true,
      typing: true,
    };
  });
}

export function applyDebugLockToNodes(list: ChatNode[]): ChatNode[] {
  if (!Array.isArray(list)) return list;
  return list.map((node) => {
    if (!node || typeof node !== 'object') return node;
    return {
      ...node,
      locked: true,
      variants: applyDebugLockToVariants(node.variants),
    };
  });
}

function clearDebugLockFromVariants(list: MessageVariant[]): MessageVariant[] {
  if (!Array.isArray(list)) return list;
  return list.map((variant) => {
    if (!variant || typeof variant !== 'object') return variant;
    let next = variant;
    let mutated = false;
    if (next.locked) {
      if (!mutated) next = { ...next };
      delete next.locked;
      mutated = true;
    }
    if (next.typing) {
      if (!mutated) next = { ...next };
      next.typing = false;
      mutated = true;
    }
    return mutated ? next : variant;
  });
}

export function clearDebugLockFromNodes(list: ChatNode[]): ChatNode[] {
  if (!Array.isArray(list)) return list;
  return list.map((node) => {
    if (!node || typeof node !== 'object') return node;
    let next = node;
    let mutated = false;
    if (next.locked) {
      next = { ...next };
      delete next.locked;
      mutated = true;
    }
    const variants = clearDebugLockFromVariants(next.variants);
    if (variants !== next.variants) {
      if (!mutated) next = { ...next };
      next.variants = variants;
      mutated = true;
    }
    return mutated ? next : node;
  });
}
