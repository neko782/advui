// IndexedDB storage for images
// Stores base64 encoded images with unique IDs
import type { StoredImage } from './types/index.js';

const DB_NAME = 'advui_images';
const DB_VERSION = 1;
const STORE_NAME = 'images';

let dbInstance: IDBDatabase | null = null;
let openPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  // Single-flight: concurrent first calls share one open request
  if (openPromise) return openPromise;

  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      openPromise = null;
      reject(request.error);
    };

    request.onblocked = () => {
      openPromise = null;
      reject(new Error('IndexedDB open blocked by another connection'));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      openPromise = null;

      // Handle version change from another tab: close and clear the cache
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };

      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });

  return openPromise;
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

async function getAllImagesInternal(): Promise<StoredImage[]> {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], 'readonly');
  const store = transaction.objectStore(STORE_NAME);

  return await new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result || []) as StoredImage[]);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllImages(): Promise<StoredImage[]> {
  try {
    return await getAllImagesInternal();
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
  /** True when validation could not be performed (e.g. DB read error). */
  validationFailed?: boolean;
}

/**
 * Validates that image references in nodes point to existing images.
 * Also identifies orphaned images that aren't referenced.
 */
export async function validateImageReferences(
  referencedIds: string[]
): Promise<ImageValidationResult> {
  try {
    // Use the throwing variant so DB read errors are distinguishable from an
    // empty store (getAllImages swallows errors and returns []).
    const allImages = await getAllImagesInternal();
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
  } catch (err) {
    // Fail safe: on a DB read error we can't know which images exist, so
    // report no missing ids (never treat everything as missing).
    console.error('Image reference validation failed:', err);
    return {
      valid: false,
      existingIds: new Set(),
      missingIds: [],
      orphanedIds: [],
      validationFailed: true,
    };
  }
}

/**
 * Checks if a specific image ID exists in the store
 */
export async function imageExists(id: string): Promise<boolean> {
  try {
    const image = await getImage(id);
    return image != null;
  } catch {
    return false;
  }
}

/**
 * Collects all image IDs referenced in a nodes array
 */
export function collectImageReferences(nodes: Array<{ variants?: Array<{ images?: unknown[], generatedImages?: unknown[] }> }>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const addImage = (img: unknown) => {
    let id: string | null = null;
    if (typeof img === 'string') {
      id = img.trim();
    } else if (img && typeof img === 'object' && typeof (img as { id?: unknown }).id === 'string') {
      id = (img as { id: string }).id.trim();
    }
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };

  for (const node of nodes || []) {
    for (const variant of node?.variants || []) {
      for (const img of variant?.images || []) {
        addImage(img);
      }
      for (const img of variant?.generatedImages || []) {
        addImage(img);
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
  nodes: Array<{ variants?: Array<{ images?: unknown[], generatedImages?: unknown[] }> }>
): Promise<{ nodes: typeof nodes; removedIds: string[] }> {
  const referencedIds = collectImageReferences(nodes);
  const validation = await validateImageReferences(referencedIds);

  // Skip cleaning when valid or when validation itself failed (a DB read
  // error must not strip every image reference from the chat).
  if (validation.valid || validation.validationFailed) {
    return { nodes, removedIds: [] };
  }

  const missingSet = new Set(validation.missingIds);
  const removedIds: string[] = [];
  let mutated = false;

  const cleanedNodes = nodes.map(node => {
    if (!node?.variants) return node;
    
    let variantsMutated = false;
    const cleanedVariants = node.variants.map(variant => {
      let nextVariant = variant;
      
      if (Array.isArray(nextVariant?.images)) {
        const cleanedImages = nextVariant.images.filter(img => {
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

        if (cleanedImages.length !== nextVariant.images.length) {
          variantsMutated = true;
          if (cleanedImages.length === 0) {
            const { images: _, ...rest } = nextVariant as { images?: unknown[] };
            nextVariant = rest;
          } else {
            nextVariant = { ...nextVariant, images: cleanedImages };
          }
        }
      }

      if (!Array.isArray(nextVariant?.generatedImages)) return nextVariant;

      const cleanedGeneratedImages = nextVariant.generatedImages.filter(img => {
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

      if (cleanedGeneratedImages.length !== nextVariant.generatedImages.length) {
        variantsMutated = true;
        if (cleanedGeneratedImages.length === 0) {
          const { generatedImages: _, ...rest } = nextVariant as { generatedImages?: unknown[] };
          return rest;
        }
        return { ...nextVariant, generatedImages: cleanedGeneratedImages };
      }
      return nextVariant;
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
