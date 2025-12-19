// Storage migration utilities
import type { Chat } from '../types/index.js';
import { putChatAtomic } from '../storage.js';

const OLD_LS_KEY = 'advui.chats.store.v1';
const MIGRATION_FLAG_KEY = 'storage.migration.completed.v1';

interface LocalStorageStore {
  version: number;
  byId: Record<string, Chat>;
}

interface MigrationResult {
  success: boolean;
  migrated: number;
  failed: number;
  skipped: number;
  errors: string[];
  reason?: string;
}

interface MigrationStatus {
  completed: boolean;
  needsMigration: boolean;
  chatsInLocalStorage: number;
  indexedDBAvailable: boolean;
}

interface MigrationFlag {
  completed: boolean;
  migratedAt: number;
  stats: { migrated: number; failed: number; skipped: number };
}

function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function getChatsFromLocalStorage(): Chat[] {
  try {
    const raw = localStorage.getItem(OLD_LS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as LocalStorageStore;
    if (!data || !data.byId) return [];
    return Object.values(data.byId);
  } catch {
    return [];
  }
}

function getMigrationFlag(): MigrationFlag | null {
  try {
    const raw = localStorage.getItem(MIGRATION_FLAG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MigrationFlag;
  } catch {
    return null;
  }
}

function setMigrationFlag(stats: { migrated: number; failed: number; skipped: number }): void {
  try {
    const flag: MigrationFlag = {
      completed: true,
      migratedAt: Date.now(),
      stats,
    };
    localStorage.setItem(MIGRATION_FLAG_KEY, JSON.stringify(flag));
  } catch {
    // Ignore errors
  }
}

export function resetMigrationFlag(): boolean {
  try {
    localStorage.removeItem(MIGRATION_FLAG_KEY);
    return true;
  } catch {
    return false;
  }
}

export function getMigrationStatus(): MigrationStatus {
  const flag = getMigrationFlag();
  const chats = getChatsFromLocalStorage();
  const indexedDBAvailable = isIndexedDBAvailable();
  
  return {
    completed: flag?.completed ?? false,
    needsMigration: chats.length > 0 && !flag?.completed && indexedDBAvailable,
    chatsInLocalStorage: chats.length,
    indexedDBAvailable,
  };
}

export function needsMigration(): boolean {
  const status = getMigrationStatus();
  return status.needsMigration;
}

export async function migrateChatsToIndexedDB(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    migrated: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  // Check if IndexedDB is available
  if (!isIndexedDBAvailable()) {
    result.success = false;
    result.reason = 'IndexedDB not available';
    return result;
  }

  // Check if already completed
  const flag = getMigrationFlag();
  if (flag?.completed) {
    result.reason = 'Already completed';
    return result;
  }

  // Check if there's data in localStorage
  let oldData: LocalStorageStore | null = null;
  try {
    const raw = localStorage.getItem(OLD_LS_KEY);
    if (!raw) {
      result.reason = 'No data to migrate';
      setMigrationFlag({ migrated: 0, failed: 0, skipped: 0 });
      return result;
    }
    oldData = JSON.parse(raw) as LocalStorageStore;
  } catch (err) {
    result.errors.push(`Failed to read localStorage: ${err instanceof Error ? err.message : String(err)}`);
    result.success = false;
    result.reason = 'Failed to read localStorage';
    return result;
  }

  if (!oldData || !oldData.byId || Object.keys(oldData.byId).length === 0) {
    result.reason = 'No chats to migrate';
    setMigrationFlag({ migrated: 0, failed: 0, skipped: 0 });
    return result;
  }

  const chats = Object.values(oldData.byId) as Chat[];
  
  for (const chat of chats) {
    try {
      await putChatAtomic(chat);
      result.migrated++;
    } catch (err) {
      result.failed++;
      result.errors.push(`Failed to migrate chat ${chat.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Mark migration as complete
  setMigrationFlag({
    migrated: result.migrated,
    failed: result.failed,
    skipped: result.skipped,
  });

  // Clear localStorage after successful migration
  if (result.migrated > 0 && result.failed === 0) {
    try {
      localStorage.removeItem(OLD_LS_KEY);
    } catch {
      // Ignore cleanup errors
    }
  }

  result.reason = `Migrated ${result.migrated} chats`;
  return result;
}
