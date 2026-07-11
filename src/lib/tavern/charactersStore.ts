// IndexedDB storage for tavern characters.
// Mirrors the minimal open/CRUD pattern used by imageStore.ts.
import { deepClone } from '../utils/immutable.js';
import type { Character } from '../types/tavern.js';

const DB_NAME = 'advui_tavern';
const DB_VERSION = 1;
const STORE_NAME = 'characters';

let dbInstance: IDBDatabase | null = null;
let openPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
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

export async function getAllCharacters(): Promise<Character[]> {
  try {
    const db = await openDB();
    const store = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
    const list = await new Promise<Character[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []) as Character[]);
      request.onerror = () => reject(request.error);
    });
    return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (err) {
    console.error('Failed to load characters:', err);
    return [];
  }
}

export async function getCharacter(id: string): Promise<Character | null> {
  if (!id) return null;
  try {
    const db = await openDB();
    const store = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
    return await new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve((request.result as Character) || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to load character:', err);
    return null;
  }
}

export async function putCharacter(character: Character): Promise<Character> {
  // Deep-clone to strip Svelte $state proxies: IndexedDB's structured clone
  // cannot serialize reactive proxy objects (DataCloneError).
  const plain: Character = { ...deepClone(character), updatedAt: Date.now() };
  const db = await openDB();
  const store = db.transaction([STORE_NAME], 'readwrite').objectStore(STORE_NAME);
  await new Promise<void>((resolve, reject) => {
    const request = store.put(plain);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  return plain;
}

export async function deleteCharacter(id: string): Promise<void> {
  if (!id) return;
  const db = await openDB();
  const store = db.transaction([STORE_NAME], 'readwrite').objectStore(STORE_NAME);
  await new Promise<void>((resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
