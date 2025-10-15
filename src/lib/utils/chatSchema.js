const VALID_ROLES = new Set(['system', 'user', 'assistant', 'tool']);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeNode(node, errors, index) {
  if (!isPlainObject(node)) {
    errors.push(`Node at index ${index} is not an object.`);
    return null;
  }
  const id = Number(node.id);
  if (!Number.isFinite(id)) {
    errors.push(`Node ${index} is missing a numeric id.`);
  }
  const variants = Array.isArray(node.variants) ? node.variants : [];
  const normalizedVariants = [];
  variants.forEach((variant, vIndex) => {
    if (!isPlainObject(variant)) {
      errors.push(`Variant ${vIndex} of node ${id} is not an object.`);
      return;
    }
    const variantId = variant.id != null ? Number(variant.id) : null;
    if (variantId == null || !Number.isFinite(variantId)) {
      errors.push(`Variant ${vIndex} of node ${id} is missing numeric id.`);
    }
    if (variant.role && !VALID_ROLES.has(variant.role)) {
      errors.push(`Variant ${variantId ?? vIndex} of node ${id} has invalid role "${variant.role}".`);
    }
    if ('images' in variant && !Array.isArray(variant.images)) {
      errors.push(`Variant ${variantId ?? vIndex} of node ${id} has invalid images collection.`);
    }
    normalizedVariants.push(variant);
  });
  return { ...node, id, variants: normalizedVariants };
}

export function validateChatObject(chat) {
  const errors = [];
  if (!isPlainObject(chat)) {
    errors.push('Chat payload must be an object.');
    return { valid: false, errors };
  }
  if (typeof chat.id !== 'string' || !chat.id.trim()) {
    errors.push('Chat id must be a non-empty string.');
  }
  if (!Array.isArray(chat.nodes)) {
    errors.push('Chat nodes must be an array.');
  }
  if (
    chat.rootId != null &&
    !Number.isFinite(Number(chat.rootId))
  ) {
    errors.push('Chat rootId must be numeric or null.');
  }
  if (chat.settings && !isPlainObject(chat.settings)) {
    errors.push('Chat settings must be an object if provided.');
  }
  if (chat.presetId != null && typeof chat.presetId !== 'string') {
    errors.push('Chat presetId must be a string when provided.');
  }

  if (Array.isArray(chat.nodes)) {
    chat.nodes.forEach((node, index) => sanitizeNode(node, errors, index));
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidChat(chat) {
  const result = validateChatObject(chat);
  if (!result.valid) {
    throw new Error(`Invalid chat object structure: ${result.errors.join(' ')}`);
  }
  return chat;
}
