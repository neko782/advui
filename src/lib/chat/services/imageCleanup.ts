import { getImage } from '../../imageStore.js';
import type { Chat, ImageValidationResult } from '../../types/index.js';

function collectImageIds(chat: Chat | null): Set<string> {
  const ids = new Set<string>();
  if (!chat || !Array.isArray(chat?.nodes)) return ids;
  const addImageId = (image: unknown) => {
    if (typeof image === 'string' && image.trim()) {
      ids.add(image.trim());
    } else if (image && typeof image === 'object' && typeof (image as { id?: unknown }).id === 'string' && (image as { id: string }).id.trim()) {
      ids.add((image as { id: string }).id.trim());
    }
  };
  for (const node of chat.nodes) {
    const variants = Array.isArray(node?.variants) ? node.variants : [];
    for (const variant of variants) {
      const images = Array.isArray(variant?.images) ? variant.images : [];
      for (const image of images) addImageId(image);
      const generatedImages = Array.isArray(variant?.generatedImages) ? variant.generatedImages : [];
      for (const image of generatedImages) addImageId(image);
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
      // Fail safe: a lookup error doesn't mean the image is missing, so
      // don't report it as orphaned.
      console.error('Image lookup failed for id:', id, err);
    }
  }
  return { valid: orphaned.length === 0, orphaned };
}
