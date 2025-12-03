import { getImage } from '../../imageStore.js';
import type { Chat, ChatNode, ImageValidationResult } from '../../types/index.js';

function collectImageIds(chat: Chat | null): Set<string> {
  const ids = new Set<string>();
  if (!chat || !Array.isArray(chat?.nodes)) return ids;
  for (const node of chat.nodes) {
    const variants = Array.isArray(node?.variants) ? node.variants : [];
    for (const variant of variants) {
      const images = Array.isArray(variant?.images) ? variant.images : [];
      for (const image of images) {
        if (typeof image === 'string' && image.trim()) {
          ids.add(image.trim());
        } else if (image && typeof image === 'object' && typeof image.id === 'string' && image.id.trim()) {
          ids.add(image.id.trim());
        }
      }
    }
  }
  return ids;
}

export async function validateImageReferences(chat: Chat | null): Promise<ImageValidationResult> {
  const imageIds = collectImageIds(chat);
  if (!imageIds.size) {
    return { valid: true, orphaned: [] };
  }
  const orphaned: string[] = [];
  for (const id of imageIds) {
    try {
      const exists = await getImage(id);
      if (!exists) orphaned.push(id);
    } catch (err) {
      console.error('Image lookup failed for id:', id, err);
      orphaned.push(id);
    }
  }
  return { valid: orphaned.length === 0, orphaned };
}

