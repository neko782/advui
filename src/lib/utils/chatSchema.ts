import type { Chat, ChatNode, MessageVariant, ChatValidationResult, MessageRole } from '../types/index.js';
import { isPlainObject } from '../types/index.js';

const VALID_ROLES: ReadonlySet<string> = new Set(['system', 'user', 'assistant', 'tool']);

interface SanitizedNode {
  id: number;
  variants: MessageVariant[];
  active: number;
  [key: string]: unknown;
}

function sanitizeNode(
  node: unknown,
  errors: string[],
  index: number
): SanitizedNode | null {
  if (!isPlainObject(node)) {
    errors.push(`Node at index ${index} is not an object.`);
    return null;
  }
  const nodeObj = node as Record<string, unknown>;
  const id = Number(nodeObj.id);
  if (!Number.isFinite(id)) {
    errors.push(`Node ${index} is missing a numeric id.`);
  }
  const variants = Array.isArray(nodeObj.variants) ? nodeObj.variants : [];
  const normalizedVariants: MessageVariant[] = [];
  variants.forEach((variant: unknown, vIndex: number) => {
    if (!isPlainObject(variant)) {
      errors.push(`Variant ${vIndex} of node ${id} is not an object.`);
      return;
    }
    const variantObj = variant as Record<string, unknown>;
    const variantId = variantObj.id != null ? Number(variantObj.id) : null;
    if (variantId == null || !Number.isFinite(variantId)) {
      errors.push(`Variant ${vIndex} of node ${id} is missing numeric id.`);
    }
    if (variantObj.role && !VALID_ROLES.has(variantObj.role as string)) {
      errors.push(`Variant ${variantId ?? vIndex} of node ${id} has invalid role "${variantObj.role}".`);
    }
    if ('images' in variantObj && !Array.isArray(variantObj.images)) {
      errors.push(`Variant ${variantId ?? vIndex} of node ${id} has invalid images collection.`);
    }
    normalizedVariants.push(variantObj as unknown as MessageVariant);
  });
  return { ...nodeObj, id, variants: normalizedVariants, active: Number(nodeObj.active) || 0 };
}

export function validateChatObject(chat: unknown): ChatValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(chat)) {
    errors.push('Chat payload must be an object.');
    return { valid: false, errors };
  }
  const chatObj = chat as Record<string, unknown>;
  if (typeof chatObj.id !== 'string' || !(chatObj.id as string).trim()) {
    errors.push('Chat id must be a non-empty string.');
  }
  if (!Array.isArray(chatObj.nodes)) {
    errors.push('Chat nodes must be an array.');
  }
  if (
    chatObj.rootId != null &&
    !Number.isFinite(Number(chatObj.rootId))
  ) {
    errors.push('Chat rootId must be numeric or null.');
  }
  if (chatObj.settings && !isPlainObject(chatObj.settings)) {
    errors.push('Chat settings must be an object if provided.');
  }
  if (chatObj.presetId != null && typeof chatObj.presetId !== 'string') {
    errors.push('Chat presetId must be a string when provided.');
  }

  if (Array.isArray(chatObj.nodes)) {
    (chatObj.nodes as unknown[]).forEach((node, index) => sanitizeNode(node, errors, index));
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidChat(chat: unknown): Chat {
  const result = validateChatObject(chat);
  if (!result.valid) {
    throw new Error(`Invalid chat object structure: ${result.errors.join(' ')}`);
  }
  return chat as Chat;
}

