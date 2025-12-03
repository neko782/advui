// IndexedDB storage for images
// Stores base64 encoded images with unique IDs
import type { StoredImage } from './types/index.js';

const DB_NAME = 'advui_images';
const DB_VERSION = 1;
const STORE_NAME = 'images';

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

export async function storeImage(
  id: string,
  base64Data: string,
  mimeType: string,
  name: string
): Promise<string> {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const image: StoredImage = {
      id,
      data: base64Data,
      mimeType,
      name,
      timestamp: Date.now()
    };

    await new Promise<void>((resolve, reject) => {
      const request = store.put(image);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    return id;
  } catch (err) {
    console.error('Failed to store image:', err);
    throw err;
  }
}

export async function getImage(id: string): Promise<StoredImage | null> {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    return await new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result as StoredImage | null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to get image:', err);
    return null;
  }
}

export async function deleteImage(id: string): Promise<void> {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to delete image:', err);
  }
}

export async function getAllImages(): Promise<StoredImage[]> {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    return await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []) as StoredImage[]);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to get all images:', err);
    return [];
  }
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix to get just the base64 data
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function generateImageId(): string {
  return `img_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Result of image reference validation
 */
export interface ImageValidationResult {
  valid: boolean;
  existingIds: Set<string>;
  missingIds: string[];
  orphanedIds: string[];
}

/**
 * Validates that image references in nodes point to existing images.
 * Also identifies orphaned images that aren't referenced.
 */
export async function validateImageReferences(
  referencedIds: string[]
): Promise<ImageValidationResult> {
  try {
    const allImages = await getAllImages();
    const existingIds = new Set(allImages.map(img => img.id));
    const referencedSet = new Set(referencedIds);

    const missingIds: string[] = [];
    const orphanedIds: string[] = [];

    // Find referenced IDs that don't exist
    for (const id of referencedIds) {
      if (!existingIds.has(id)) {
        missingIds.push(id);
      }
    }

    // Find stored images that aren't referenced
    for (const id of existingIds) {
      if (!referencedSet.has(id)) {
        orphanedIds.push(id);
      }
    }

    return {
      valid: missingIds.length === 0,
      existingIds,
      missingIds,
      orphanedIds,
    };
  } catch {
    return {
      valid: false,
      existingIds: new Set(),
      missingIds: referencedIds,
      orphanedIds: [],
    };
  }
}

/**
 * Checks if a specific image ID exists in the store
 */
export async function imageExists(id: string): Promise<boolean> {
  try {
    const image = await getImage(id);
    return image !== null;
  } catch {
    return false;
  }
}

/**
 * Collects all image IDs referenced in a nodes array
 */
export function collectImageReferences(nodes: Array<{ variants?: Array<{ images?: Array<{ id?: string } | string> }> }>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const node of nodes || []) {
    for (const variant of node?.variants || []) {
      for (const img of variant?.images || []) {
        let id: string | null = null;
        if (typeof img === 'string') {
          id = img.trim();
        } else if (img && typeof img === 'object' && typeof img.id === 'string') {
          id = img.id.trim();
        }
        if (id && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
  }

  return ids;
}

/**
 * Removes invalid image references from nodes.
 * Returns the cleaned nodes and list of removed references.
 */
export async function cleanInvalidImageReferences(
  nodes: Array<{ variants?: Array<{ images?: unknown[] }> }>
): Promise<{ nodes: typeof nodes; removedIds: string[] }> {
  const referencedIds = collectImageReferences(nodes);
  const validation = await validateImageReferences(referencedIds);

  if (validation.valid) {
    return { nodes, removedIds: [] };
  }

  const missingSet = new Set(validation.missingIds);
  const removedIds: string[] = [];
  let mutated = false;

  const cleanedNodes = nodes.map(node => {
    if (!node?.variants) return node;
    
    let variantsMutated = false;
    const cleanedVariants = node.variants.map(variant => {
      if (!Array.isArray(variant?.images)) return variant;
      
      const cleanedImages = variant.images.filter(img => {
        let id: string | null = null;
        if (typeof img === 'string') {
          id = img.trim();
        } else if (img && typeof img === 'object' && typeof (img as { id?: string }).id === 'string') {
          id = ((img as { id: string }).id).trim();
        }
        if (id && missingSet.has(id)) {
          removedIds.push(id);
          return false;
        }
        return true;
      });

      if (cleanedImages.length !== variant.images.length) {
        variantsMutated = true;
        if (cleanedImages.length === 0) {
          const { images: _, ...rest } = variant as { images?: unknown[] };
          return rest;
        }
        return { ...variant, images: cleanedImages };
      }
      return variant;
    });

    if (variantsMutated) {
      mutated = true;
      return { ...node, variants: cleanedVariants };
    }
    return node;
  });

  return {
    nodes: mutated ? cleanedNodes : nodes,
    removedIds: [...new Set(removedIds)],
  };
}

