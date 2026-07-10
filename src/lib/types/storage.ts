// ============================================================================
// Storage Types
// Storage backends, caches, and export/import formats.
// ============================================================================

import type { Chat, ChatListItem } from './chat.js';

// ============================================================================
// Stored Media Types
// ============================================================================

export interface StoredImage {
  id: string;
  data: string;
  mimeType?: string;
  name?: string;
  timestamp: number;
}

// ============================================================================
// Models Cache Types
// ============================================================================

export interface ModelsCacheEntry {
  ids: string[];
  fetchedAt: number;
}

export interface ModelsStore {
  version?: number;
  entries: Record<string, ModelsCacheEntry>;
}

// ============================================================================
// Storage Backend Types
// ============================================================================

export interface StorageChange {
  type: 'put' | 'delete' | 'sync';
  chat?: Chat;
  chatId?: string;
  version?: number;
  fromOtherTab?: boolean;
  store?: {
    version: number;
    byId: Record<string, Chat>;
  };
}

export type StorageListener = (change: StorageChange) => void;

export interface StorageBackend {
  getAllChats(): Promise<Chat[]>;
  getChatListItems(): Promise<ChatListItem[]>;
  getChat(id: string): Promise<Chat | null>;
  putChat(chat: Chat): Promise<Chat>;
  deleteChat(id: string, expectedVersion?: number): Promise<Chat | null>;
  subscribeChatStorage(listener: StorageListener): () => void;
  isIndexedDBAvailable?(): boolean;
}

export interface LocalStorageStore {
  version: number;
  byId: Record<string, Chat>;
}

export interface SafeWriteOptions {
  warnThresholdBytes?: number;
}

// ============================================================================
// Export/Import Types
// ============================================================================

export interface ExportedChat {
  version: number;
  type: 'single_chat';
  exportedAt: string;
  chat: Chat;
}

export interface ImportResult {
  chatsImported: number;
  settingsImported: boolean;
  imagesImported: number;
  errors: string[];
}

export interface ChatManifestEntry {
  id: string;
  title: string;
  path: string;
  order?: number;
  updatedAt?: number;
}

export interface ImageManifestEntry {
  id: string;
  filename: string;
  mimeType?: string;
  name?: string;
}

export interface TarArchive {
  list(prefix?: string): string[];
  getText(path: string): Promise<string | null>;
  getBase64(path: string): Promise<string | null>;
}
