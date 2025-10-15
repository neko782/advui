# Storage Architecture

This document describes the storage architecture for chat data, including the migration from localStorage to IndexedDB.

## Overview

The application uses a **dual-backend storage system** with automatic migration:
- **Primary backend**: IndexedDB (for chat data)
- **Fallback backend**: localStorage (when IndexedDB is unavailable)
- **Small data storage**: localStorage (for settings, theme, etc.)

## Architecture

### Storage Layers

```
┌─────────────────────────────────────────┐
│         Application Layer               │
│  (chatsStore.js, App.svelte, etc.)     │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│      Storage Abstraction Layer          │
│           (storage.js)                  │
│  • Detects available backend            │
│  • Routes operations to backend         │
│  • Provides unified API                 │
└─────────────────────────────────────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
┌─────────────────┐   ┌─────────────────┐
│  IndexedDB      │   │  localStorage   │
│  Backend        │   │  Backend        │
│  (Primary)      │   │  (Fallback)     │
└─────────────────┘   └─────────────────┘
```

### File Structure

- **`src/lib/storage.js`**: Main storage abstraction layer
  - Automatically selects IndexedDB or localStorage backend
  - Provides unified API: `getAllChats()`, `getChat()`, `putChat()`, `deleteChat()`
  - Handles backend detection and initialization

- **`src/lib/storage.indexeddb.js`**: IndexedDB storage implementation
  - Database: `advui_chats` (version 1)
  - Object store: `chats` (keyPath: `id`)
  - Index: `idx_updatedAt` (for efficient sorting)
  - Features:
    - Versioning and optimistic concurrency control
    - Cross-tab synchronization via BroadcastChannel
    - Image reference validation
    - Deep cloning for data isolation

- **`src/lib/storage.localStorage.js`**: localStorage storage implementation
  - Key: `advui.chats.store.v1`
  - Fallback when IndexedDB is unavailable
  - Same API as IndexedDB backend
  - Cross-tab synchronization via storage events

- **`src/lib/utils/storageMigration.js`**: Migration utilities
  - Automatic migration from localStorage to IndexedDB
  - One-time migration with completion tracking
  - Verification of migrated data
  - Safe migration (preserves localStorage data)

## IndexedDB Schema

### Database: `advui_chats` (v1)

**Object Store: `chats`**
- Key path: `id` (string, e.g., `c_abc123_xyz`)
- Fields:
  ```typescript
  {
    id: string              // Unique chat ID
    title: string           // Chat title (auto-generated from first user message)
    nodes: Array<Node>      // Graph of message nodes
    rootId: number          // ID of root node
    settings: {             // Chat-specific settings
      model: string
      streaming: boolean
      maxOutputTokens: number | null
      topP: number | null
      temperature: number | null
      reasoningEffort: string
      textVerbosity: string
      reasoningSummary: string
      thinkingEnabled: boolean
      thinkingBudgetTokens: number | null
      connectionId: string
    }
    presetId: string | null // Associated preset ID
    updatedAt: number       // Last update timestamp
    _version: number        // Optimistic concurrency control version
    _persistedAt: number    // Timestamp when persisted
  }
  ```

**Index: `idx_updatedAt`**
- Field: `updatedAt`
- Non-unique
- Used for efficient sorting of chats by recency

## Migration Process

### How It Works

1. **Startup Check** (in `App.svelte`):
   - On app mount, migration is triggered automatically
   - Checks if migration is needed and not already completed

2. **Migration Steps**:
   ```
   1. Check if IndexedDB is available
      ├─ No  → Skip migration (use localStorage)
      └─ Yes → Continue

   2. Check if migration already completed
      ├─ Yes → Skip migration
      └─ No  → Continue

   3. Read all chats from localStorage
      ├─ None found → Mark migration complete
      └─ Chats found → Continue

   4. Check existing chats in IndexedDB
      └─ Create set of existing IDs

   5. For each chat in localStorage:
      ├─ Already in IndexedDB? → Skip
      ├─ Migration succeeds? → Count as migrated
      └─ Migration fails? → Count as failed

   6. Verify all migrations
      └─ All successful? → Mark migration complete
   ```

3. **Migration Tracking**:
   - Flag stored in localStorage: `storage.migration.completed.v1`
   - Contains:
     ```javascript
     {
       completed: true,
       migratedAt: timestamp,
       stats: {
         migrated: number,
         failed: number,
         skipped: number
       }
     }
     ```

### Data Safety

- **Non-destructive**: localStorage data is preserved during migration
- **Verification**: Each migrated chat is verified before proceeding
- **Idempotent**: Migration can be run multiple times safely
- **Graceful failure**: If migration fails, app continues with localStorage

## Cross-Tab Synchronization

### IndexedDB Backend

Uses **BroadcastChannel API** for real-time cross-tab sync:
- Channel name: `advui_chats_sync`
- Message types:
  - `chat_update`: When a chat is created or modified
  - `chat_delete`: When a chat is deleted
- Fallback: None (BroadcastChannel widely supported)

### localStorage Backend

Uses **storage events** for cross-tab sync:
- Listens to changes on `advui.chats.store.v1` key
- Automatically syncs across tabs
- Standard browser API

## Concurrency Control

Both backends implement **optimistic concurrency control**:

```javascript
// Reading a chat
const chat = await getChat(chatId)
// chat._version = 5

// Modifying the chat
chat.title = 'New Title'
chat._expectedVersion = chat._version

// Writing back
await putChat(chat)
// Success: _version incremented to 6
// Conflict: Error if another tab modified it first
```

This prevents data loss when multiple tabs modify the same chat.

## Storage Limits

### IndexedDB
- **Typical limit**: 50% of available disk space (varies by browser)
- **Practical limit**: Several GB to tens of GB
- **Quota management**: Browsers manage quota automatically
- **Error handling**: QuotaExceededError caught and logged

### localStorage
- **Limit**: ~5-10 MB (varies by browser)
- **Used for**: Settings, theme, sidebar state, selected chat ID
- **Chat data**: Moved to IndexedDB to avoid quota issues

## Testing

### Test Files

- `src/lib/storage.indexeddb.test.js`: IndexedDB backend tests
- `src/lib/utils/storageMigration.test.js`: Migration tests

### Running Tests

```bash
npm test                 # Run all tests
npm run test:ui          # Open test UI
npm run test:coverage    # Generate coverage report
```

### Test Environment

- Uses **happy-dom** for DOM APIs (localStorage, etc.)
- IndexedDB not available in test environment (tests handle this gracefully)
- Tests validate API surface and error handling

## Troubleshooting

### Migration Issues

**Problem**: Migration stuck or incomplete
```javascript
// Check migration status
import { getMigrationStatus, resetMigrationFlag } from './lib/utils/storageMigration.js'

const status = getMigrationStatus()
console.log(status)

// Reset migration (if needed)
resetMigrationFlag()
```

**Problem**: Data not syncing across tabs
- Check browser console for BroadcastChannel errors
- Verify IndexedDB is enabled in browser settings
- Check if browser supports BroadcastChannel (all modern browsers do)

**Problem**: Out of storage space
- IndexedDB: Check browser quota settings
- localStorage: Settings should be small, but verify total size

### Debugging

**Check active backend**:
```javascript
import { getBackendName } from './lib/storage.js'
console.log('Active backend:', getBackendName())
```

**Inspect IndexedDB**:
1. Open DevTools
2. Go to Application → Storage → IndexedDB
3. Expand `advui_chats` → `chats`
4. View stored chats

**Inspect localStorage**:
1. Open DevTools
2. Go to Application → Storage → Local Storage
3. Look for keys:
   - `advui.chats.store.v1` (old chat storage)
   - `storage.migration.completed.v1` (migration flag)
   - `storage.backend.v1` (active backend)

## Future Improvements

- [ ] Add cleanup job to remove old localStorage chat data after migration
- [ ] Implement storage quota warnings for users
- [ ] Add compression for large chat histories
- [ ] Implement periodic garbage collection for orphaned images
- [ ] Add export/import functionality for chats
- [ ] Implement backup/restore functionality
- [ ] Add storage analytics dashboard

## References

- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
- [Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- [Storage Quota](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
