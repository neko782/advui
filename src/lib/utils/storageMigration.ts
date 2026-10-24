// Migrates chats left in localStorage by older versions (which used it as
// the primary store, and later as a fallback when IndexedDB failed) into
// IndexedDB, which is now the only chat backend.
import type { Chat } from '../types/index.js';
import { updateChatAtomic } from '../storage.js';

const OLD_LS_KEY = 'advui.chats.store.v1';
const MIGRATION_FLAG_KEY = 'storage.migration.completed.v1';
// Written by the removed localStorage fallback; obsolete once migrated.
const LEGACY_BACKEND_KEY = 'storage.backend.v1';

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
  
  // Any remaining legacy data needs migrating, even after an earlier
  // successful run: the old fallback could write newer chats there later.
  const completed = !!flag?.completed && !flag.stats?.failed && chats.length === 0;
  return {
    completed,
    needsMigration: chats.length > 0 && indexedDBAvailable,
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

  // Check if there's data in localStorage
  let oldData: LocalStorageStore | null = null;
  try {
    const raw = localStorage.getItem(OLD_LS_KEY);
    if (!raw) {
      result.reason = 'No data to migrate';
      try { localStorage.removeItem(LEGACY_BACKEND_KEY); } catch { /* ignore */ }
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
    try {
      localStorage.removeItem(OLD_LS_KEY);
      localStorage.removeItem(LEGACY_BACKEND_KEY);
    } catch { /* ignore */ }
    setMigrationFlag({ migrated: 0, failed: 0, skipped: 0 });
    return result;
  }

  const chats = Object.values(oldData.byId) as Chat[];
  
  for (const chat of chats) {
    try {
      let skipped = false;
      await updateChatAtomic(chat.id, current => {
        if (current && (Number(current.updatedAt) || 0) >= (Number(chat.updatedAt) || 0)) {
          skipped = true;
          return undefined;
        }
        return chat;
      });
      if (skipped) result.skipped++;
      else result.migrated++;
    } catch (err) {
      result.failed++;
      result.errors.push(`Failed to migrate chat ${chat.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Keep partial failures retryable; existing destination chats are skipped.
  if (result.failed > 0) {
    result.success = false;
    result.reason = result.migrated === 0 ? 'Migration failed for all chats' : 'Migration partially failed';
    return result;
  }

  // Mark migration as complete
  setMigrationFlag({
    migrated: result.migrated,
    failed: result.failed,
    skipped: result.skipped,
  });

  // Every legacy chat is now in IndexedDB (migrated, or already present with
  // an equal or newer copy), so the legacy store can be removed.
  try {
    localStorage.removeItem(OLD_LS_KEY);
    localStorage.removeItem(LEGACY_BACKEND_KEY);
  } catch {
    // Ignore cleanup errors
  }

  result.reason = `Migrated ${result.migrated} chats`;
  return result;
}
