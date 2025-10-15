// Storage migration from localStorage to IndexedDB
import { safeRead, safeWrite } from './localStorageHelper.js'
import * as idbStorage from '../storage.indexeddb.js'

const MIGRATION_FLAG_KEY = 'storage.migration.completed.v1'
const LS_CHATS_KEY = 'advui.chats.store.v1'

/**
 * Check if migration has already been completed
 */
function isMigrationCompleted() {
  const flag = safeRead(MIGRATION_FLAG_KEY, null, (value) => {
    if (value && typeof value === 'object' && value.completed === true) {
      return value
    }
    return null
  })
  return flag !== null
}

/**
 * Mark migration as completed
 */
function markMigrationCompleted(stats) {
  const flag = {
    completed: true,
    migratedAt: Date.now(),
    stats,
  }
  safeWrite(MIGRATION_FLAG_KEY, flag)
}

/**
 * Read all chats from localStorage
 */
function readChatsFromLocalStorage() {
  const data = safeRead(LS_CHATS_KEY, null, (value) => {
    if (!value || typeof value !== 'object') return null
    return value
  })

  if (!data || !data.byId || typeof data.byId !== 'object') {
    return []
  }

  return Object.values(data.byId).filter(chat => chat && typeof chat === 'object')
}

/**
 * Validate that a chat was successfully migrated
 */
async function verifyChatMigration(chatId, originalChat) {
  try {
    const migratedChat = await idbStorage.getChat(chatId)
    if (!migratedChat) return false

    // Basic validation - check ID and key properties exist
    if (migratedChat.id !== originalChat.id) return false
    if (!Array.isArray(migratedChat.nodes)) return false

    return true
  } catch (err) {
    console.error(`Verification failed for chat ${chatId}:`, err)
    return false
  }
}

/**
 * Migrate chats from localStorage to IndexedDB
 */
export async function migrateChatsToIndexedDB() {
  // Check if IndexedDB is available
  if (!idbStorage.isIndexedDBAvailable()) {
    console.warn('IndexedDB not available, skipping migration')
    return {
      success: false,
      reason: 'IndexedDB not available',
      migrated: 0,
      failed: 0,
      skipped: 0,
    }
  }

  // Check if migration already completed
  if (isMigrationCompleted()) {
    console.log('Migration already completed, skipping')
    return {
      success: true,
      reason: 'Already completed',
      migrated: 0,
      failed: 0,
      skipped: 0,
    }
  }

  console.log('Starting chat migration from localStorage to IndexedDB...')

  try {
    // Read all chats from localStorage
    const chatsToMigrate = readChatsFromLocalStorage()

    if (chatsToMigrate.length === 0) {
      console.log('No chats found in localStorage, marking migration as complete')
      markMigrationCompleted({ migrated: 0, failed: 0, skipped: 0 })
      return {
        success: true,
        reason: 'No chats to migrate',
        migrated: 0,
        failed: 0,
        skipped: 0,
      }
    }

    console.log(`Found ${chatsToMigrate.length} chats to migrate`)

    // Check what's already in IndexedDB
    const existingChats = await idbStorage.getAllChats()
    const existingIds = new Set(existingChats.map(c => c.id))

    let migrated = 0
    let failed = 0
    let skipped = 0

    // Migrate each chat
    for (const chat of chatsToMigrate) {
      try {
        // Skip if already exists in IndexedDB
        if (existingIds.has(chat.id)) {
          console.log(`Chat ${chat.id} already exists in IndexedDB, skipping`)
          skipped++
          continue
        }

        // Remove the _version and _expectedVersion from localStorage data
        // as IndexedDB will assign new versions
        const chatToMigrate = { ...chat }
        delete chatToMigrate._version
        delete chatToMigrate._expectedVersion

        // Write to IndexedDB
        await idbStorage.putChat(chatToMigrate)

        // Verify the migration
        const verified = await verifyChatMigration(chat.id, chat)
        if (!verified) {
          console.error(`Failed to verify migration for chat ${chat.id}`)
          failed++
          continue
        }

        migrated++
        console.log(`Successfully migrated chat ${chat.id}`)
      } catch (err) {
        console.error(`Failed to migrate chat ${chat.id}:`, err)
        failed++
      }
    }

    const stats = { migrated, failed, skipped }
    console.log('Migration complete:', stats)

    // Mark migration as completed only if no failures
    if (failed === 0) {
      markMigrationCompleted(stats)
    }

    return {
      success: failed === 0,
      reason: failed > 0 ? `${failed} chats failed to migrate` : 'Success',
      migrated,
      failed,
      skipped,
    }
  } catch (err) {
    console.error('Migration failed:', err)
    return {
      success: false,
      reason: err.message || 'Unknown error',
      migrated: 0,
      failed: 0,
      skipped: 0,
      error: err,
    }
  }
}

/**
 * Check if there are chats in localStorage that need migration
 */
export function needsMigration() {
  if (isMigrationCompleted()) return false
  if (!idbStorage.isIndexedDBAvailable()) return false

  const chats = readChatsFromLocalStorage()
  return chats.length > 0
}

/**
 * Get migration status
 */
export function getMigrationStatus() {
  const completed = isMigrationCompleted()
  const chatsInLocalStorage = readChatsFromLocalStorage().length

  return {
    completed,
    needsMigration: !completed && chatsInLocalStorage > 0,
    chatsInLocalStorage,
    indexedDBAvailable: idbStorage.isIndexedDBAvailable(),
  }
}

/**
 * Reset migration flag (for testing purposes)
 */
export function resetMigrationFlag() {
  try {
    localStorage.removeItem(MIGRATION_FLAG_KEY)
    return true
  } catch {
    return false
  }
}
