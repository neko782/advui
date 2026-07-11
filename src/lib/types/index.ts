// ============================================================================
// Types barrel — re-exports the domain type modules.
// Prefer importing from the specific module for new code:
//   ./api.js      — provider/API request & response types
//   ./chat.js     — conversation graph, chat records, chat-service contracts
//   ./settings.js — connections, presets, app settings, theme
//   ./storage.js  — storage backends, caches, export/import formats
//
// This file must contain types only. Runtime helpers live in:
//   ../utils/objects.js  — isPlainObject, hasOwn
//   ../utils/mcp.js      — normalizeMcpServerList
//   ../constants/defaults.js — DEFAULT_MESSAGE_ACTIONS, DEFAULT_EDITOR_ACTIONS,
//                              DEFAULT_TOOL_SETTINGS
// ============================================================================

export type * from './api.js';
export type * from './chat.js';
export type * from './settings.js';
export type * from './storage.js';
export type * from './tavern.js';

// ---------------------------------------------------------------------------
// Backwards-compatible aliases (older code imports these names)
// ---------------------------------------------------------------------------
import type { ChatNode, MessageVariant } from './chat.js';
import type { ImageData, ImageReference } from './api.js';
import type { Settings } from './settings.js';

export type Node = ChatNode;
export type Message = MessageVariant;
export type Image = ImageData;
export type ImageRef = ImageReference;
export type AppSettings = Settings;
