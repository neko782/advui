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

