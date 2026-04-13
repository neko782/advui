// Chat store persisted in localStorage. One entry per chat.
// We keep selectedId in localStorage for quick access.

import { loadSettings } from './settingsStore.js';
import { enforceUniqueParents, normalizeNodesActive, validateRootId } from './branching.js';
import {
  getAllChats as storeGetAll,
  getChatListItems as storeGetAllListItems,
  getChat as storeGetOne,
  putChatAtomic as storePutAtomic,
  updateChatAtomic as storeUpdateAtomic,
  deleteChatAtomic as storeDeleteAtomic
} from './storage.js';
import { toIntOrNull, toClampedNumber } from './utils/numbers.js';
import { safeRead, safeWrite } from './utils/localStorageHelper.js';
import { resolvePreset, DEFAULT_SYSTEM_PROMPT, computeConnectionId } from './utils/presetHelpers.js';
import { normalizeReasoning, normalizeVerbosity, normalizeReasoningSummary } from './utils/validation.js';
import type { Chat, ChatListItem, ChatNode, ChatSettings, ChatSelection, MessageVariant } from './types/index.js';
import { hasOwn } from './types/index.js';

export const SELECTED_KEY = 'openai.chats.selected.v1';

// In-memory cache for newly created chats to avoid storage roundtrip delay
const chatCache = new Map<string, Chat>();

function cacheChat(id: string, chat: Chat): void {
  chatCache.set(id, chat);
  // Auto-clear cache after 1 second to prevent memory leaks
  setTimeout(() => chatCache.delete(id), 1000);
}

export function getCachedChat(id: string): Chat | undefined {
  return chatCache.get(id);
}

function sanitizeVariantLockState(variant: MessageVariant | null | undefined): MessageVariant | null | undefined {
  if (!variant || typeof variant !== 'object') return variant;
  let mutated = false;
  let next: MessageVariant = variant;
  if (hasOwn(next, 'locked')) {
    if (!mutated) next = { ...next };
    delete (next as { locked?: boolean }).locked;
    mutated = true;
  }
  if (next?.typing) {
    if (!mutated) next = { ...next };
    next.typing = false;
    mutated = true;
  } else if (hasOwn(next, 'typing') && typeof next.typing !== 'boolean') {
    if (!mutated) next = { ...next };
    next.typing = false;
    mutated = true;
  }
  return mutated ? next : variant;
}

function sanitizeNodeLockState(node: ChatNode | null | undefined): ChatNode | null | undefined {
  if (!node || typeof node !== 'object') return node;
  let mutated = false;
  let next: ChatNode = node;
  if (hasOwn(next, 'locked')) {
    if (!mutated) next = { ...next };
    delete (next as { locked?: boolean }).locked;
    mutated = true;
  }
  const variants = Array.isArray(next?.variants) ? next.variants : null;
  if (variants && variants.length) {
    const sanitizedVariants = variants.map(sanitizeVariantLockState) as MessageVariant[];
    let changed = false;
    for (let i = 0; i < variants.length; i += 1) {
      if (sanitizedVariants[i] !== variants[i]) {
        changed = true;
        break;
      }
    }
    if (changed) {
      if (!mutated) next = { ...next };
      next.variants = sanitizedVariants;
      mutated = true;
    }
  }
  return mutated ? next : node;
}

function sanitizeChatLockState(chat: Chat | null | undefined): Chat | null | undefined {
  if (!chat || typeof chat !== 'object') return chat;
  let mutated = false;
  let next: Chat = chat;
  if (hasOwn(next, 'locked')) {
    next = { ...next };
    delete (next as { locked?: boolean }).locked;
    mutated = true;
  }
  if (Array.isArray(next?.nodes) && next.nodes.length) {
    const sanitizedNodes = next.nodes.map(sanitizeNodeLockState) as ChatNode[];
    let changed = false;
    for (let i = 0; i < next.nodes.length; i += 1) {
      if (sanitizedNodes[i] !== next.nodes[i]) {
        changed = true;
        break;
      }
    }
    if (changed) {
      if (!mutated) next = { ...next };
      next.nodes = sanitizedNodes;
      mutated = true;
    }
  }
  return mutated ? next : chat;
}

function applyVariantLockState(variant: MessageVariant): MessageVariant {
  if (!variant || typeof variant !== 'object') return variant;
  return {
    ...variant,
    locked: true,
    typing: true,
  } as MessageVariant;
}

function applyNodeLockState(node: ChatNode): ChatNode {
  if (!node || typeof node !== 'object') return node;
  const variants = Array.isArray(node?.variants)
    ? node.variants.map(applyVariantLockState)
    : node.variants;
  return {
    ...node,
    locked: true,
    variants,
  } as ChatNode;
}

function applyChatLockState(chat: Chat): Chat {
  if (!chat || typeof chat !== 'object') return chat;
  const next: Chat = {
    ...chat,
    locked: true,
  } as Chat;
  if (Array.isArray(chat?.nodes)) {
    next.nodes = chat.nodes.map(applyNodeLockState);
  }
  return next;
}

export function loadAll(): ChatSelection {
  // Back-compat shim for existing callers that expect { selectedId }
  const selection = safeRead<ChatSelection>(SELECTED_KEY, { selectedId: null }, (value) => {
    if (value && typeof value === 'object' && 'selectedId' in (value as object)) return value as ChatSelection;
    return { selectedId: null };
  });
  return { selectedId: selection?.selectedId ?? null };
}

export function setSelected(id: string | null): ChatSelection {
  const val: ChatSelection = { selectedId: id || null };
  const ok = safeWrite(SELECTED_KEY, val);
  if (!ok) {
    console.error('Failed to persist selected chat id.');
  }
  return val;
}

export async function getChats(): Promise<Chat[]> {
  // Return all chats; sort done by callers if needed
  try { return await storeGetAll(); } catch { return []; }
}

export function toChatListItem(chat: Chat | null | undefined): ChatListItem | null {
  if (!chat?.id) return null;
  return {
    id: chat.id,
    title: typeof chat.title === 'string' && chat.title.trim() ? chat.title : 'New Chat',
    updatedAt: Number(chat.updatedAt) || 0,
  };
}

export async function getChatListItems(): Promise<ChatListItem[]> {
  try { return await storeGetAllListItems(); } catch { return []; }
}

export async function unlockAllChats(): Promise<void> {
  try {
    const list = await storeGetAll();
    for (const chat of list) {
      await storeUpdateAtomic(chat.id, (current) => {
        if (!current) return undefined;
        const sanitized = sanitizeChatLockState(current);
        if (!sanitized || sanitized === current) return undefined;
        return {
          ...sanitized,
          updatedAt: Date.now(),
        };
      });
    }
  } catch {
    /* ignore unlock errors */
  }
}

export async function getChat(id: string): Promise<Chat | null> {
  try { return await storeGetOne(id); } catch { return null; }
}

export function computeTitleFromNodes(nodes: ChatNode[] | null, rootId: number | null): string {
  try {
    const byId = new Map((nodes || []).map(n => [n.id, n]));
    const guard = new Set<number>();
    let cur = rootId;
    let title = '';
    let steps = 0;
    while (cur != null && steps < 200) {
      steps++;
      if (guard.has(cur)) break;
      guard.add(cur);
      const n = byId.get(cur);
      if (!n) break;
      const vi = Math.max(0, Math.min((n?.variants?.length || 1) - 1, Number(n?.active) || 0));
      const v = n?.variants?.[vi];
      if (!v) break;
      if (!title && v?.role === 'user' && typeof v?.content === 'string' && v.content.trim()) {
        title = (v.content || '').trim();
      }
      if (v?.next == null) break;
      cur = v.next;
    }
    const base = title || 'New Chat';
    return base.length > 40 ? (base.slice(0, 40) + '…') : base;
  } catch { return 'New Chat'; }
}

export async function upsertChat(chat: Chat): Promise<Chat> {
  // Persist chat
  try {
    const persisted = await storePutAtomic(chat);
    return persisted || chat;
  } catch (err) {
    console.error('Failed to upsert chat:', err);
    return chat;
  }
}

export interface SaveChatContentOptions {
  nodes?: ChatNode[];
  settings?: Partial<ChatSettings>;
  rootId?: number | null;
}

export async function saveChatContent(
  id: string,
  options: SaveChatContentOptions
): Promise<Chat | null> {
  const { nodes, settings, rootId } = options;
  if (!id) return null;
  try {
    return await storeUpdateAtomic(id, (existing) => {
      // If the chat doesn't exist (e.g., was deleted), don't recreate it
      if (!existing) return undefined;
      const defaults = loadSettings();
      const basePreset = resolvePreset(defaults, { presetId: settings?.presetId || existing?.presetId || undefined });
      const pickSetting = <K extends keyof ChatSettings>(key: K): ChatSettings[K] | undefined => {
        if (settings && hasOwn(settings, key)) return settings[key] as ChatSettings[K];
        if (existing?.settings && hasOwn(existing.settings, key)) return existing.settings[key];
        if (hasOwn(basePreset, key)) return (basePreset as unknown as ChatSettings)[key];
        return undefined;
      };
      const rawConnectionOverride = pickSetting('connectionId');
      const candidatePreset = {
        ...basePreset,
        connectionId: (() => {
          if (typeof rawConnectionOverride === 'string' && rawConnectionOverride.trim()) return rawConnectionOverride.trim();
          return basePreset?.connectionId || null;
        })(),
      };
      const resolvedConnectionId = computeConnectionId({
        preset: candidatePreset,
        settings: defaults,
      });
      const baseSettings: ChatSettings = {
        model: (settings?.model || existing?.settings?.model || basePreset.model || 'gpt-5'),
        streaming: (typeof settings?.streaming === 'boolean')
          ? settings.streaming
          : (typeof existing?.settings?.streaming === 'boolean'
            ? existing.settings.streaming
            : (typeof basePreset.streaming === 'boolean' ? basePreset.streaming : true)),
        maxOutputTokens: toIntOrNull(pickSetting('maxOutputTokens')),
        topP: toClampedNumber(pickSetting('topP'), 0, 1),
        temperature: toClampedNumber(pickSetting('temperature'), 0, 2),
        reasoningEffort: normalizeReasoning(pickSetting('reasoningEffort')),
        textVerbosity: normalizeVerbosity(pickSetting('textVerbosity')),
        reasoningSummary: normalizeReasoningSummary(pickSetting('reasoningSummary')),
        thinkingEnabled: !!pickSetting('thinkingEnabled'),
        thinkingBudgetTokens: toIntOrNull(pickSetting('thinkingBudgetTokens')),
        connectionId: resolvedConnectionId,
        // Web Search settings
        webSearchEnabled: !!pickSetting('webSearchEnabled'),
        webSearchDomains: pickSetting('webSearchDomains') || undefined,
        webSearchCountry: pickSetting('webSearchCountry') || undefined,
        webSearchCity: pickSetting('webSearchCity') || undefined,
        webSearchRegion: pickSetting('webSearchRegion') || undefined,
        webSearchTimezone: pickSetting('webSearchTimezone') || undefined,
        webSearchCacheOnly: !!pickSetting('webSearchCacheOnly'),
        // Code Interpreter settings
        codeInterpreterEnabled: !!pickSetting('codeInterpreterEnabled'),
        // Shell settings
        shellEnabled: !!pickSetting('shellEnabled'),
        // Image Generation settings
        imageGenerationEnabled: !!pickSetting('imageGenerationEnabled'),
        imageGenerationModel: pickSetting('imageGenerationModel') || undefined,
      };
      const nextNodesCandidate = Array.isArray(nodes) ? nodes : (existing?.nodes || []);
      const hasNodes = nextNodesCandidate.length > 0;

      // Normalize active indices to ensure they're within bounds
      const normalizedNodes = normalizeNodesActive(nextNodesCandidate);

      // Determine and validate rootId
      let candidateRootId: number | null;
      if (rootId != null) {
        candidateRootId = rootId;
      } else if (!hasNodes) {
        candidateRootId = null;
      } else if (existing?.rootId != null && normalizedNodes.some(n => n?.id === existing.rootId)) {
        candidateRootId = existing.rootId;
      } else {
        candidateRootId = normalizedNodes[0]?.id ?? null;
      }

      // Validate rootId points to a valid root (no incoming edges)
      const rootValidation = validateRootId(normalizedNodes, candidateRootId);
      const nextRootId = rootValidation.rootId;

      // Enforce single-parent invariant before persisting (skip in debug mode)
      const dbg = !!defaults?.debug;
      const nextNodes = dbg ? normalizedNodes : enforceUniqueParents(normalizedNodes, nextRootId);
      const presetId = (typeof settings?.presetId === 'string')
        ? settings.presetId
        : (typeof existing?.presetId === 'string' ? existing.presetId : (basePreset?.id || null));
      const updated: Chat = {
        ...(existing || { id }),
        id,
        nodes: nextNodes,
        rootId: nextRootId,
        settings: baseSettings,
        presetId,
        title: computeTitleFromNodes(nextNodes, nextRootId),
        updatedAt: Date.now(),
      };
      return updated;
    });
  } catch (err) {
    console.error('Failed to save chat content:', err);
    return null;
  }
}

export async function deleteChat(id: string): Promise<void> {
  if (!id) return;
  await storeDeleteAtomic(id);
  const selected = loadAll().selectedId;
  if (selected === id) setSelected(null);
}

export async function renameChat(id: string, title: string): Promise<Chat | null> {
  if (!id) return null;
  const nextTitle = (typeof title === 'string' && title.trim()) ? title.trim() : 'New Chat';
  return await storeUpdateAtomic(id, (chat) => {
    if (!chat) return undefined;
    return {
      ...chat,
      title: nextTitle,
      updatedAt: Date.now(),
    };
  });
}

export interface CreateChatOptions {
  nodes?: ChatNode[];
  rootId?: number | null;
  messages?: Array<{ id?: number; role: string; content: string; time?: number; typing?: boolean; error?: string }>;
  settings?: Partial<ChatSettings>;
  model?: string;
  presetId?: string;
  preset?: Record<string, unknown>;
  connectionId?: string;
  /** Optional: preserve original updatedAt timestamp (for imports) */
  updatedAt?: number;
  /** Optional: preserve original title (for imports) */
  title?: string;
}

export async function createChat(initial: CreateChatOptions = {}): Promise<{ id: string; chat: Chat }> {
  const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const defaults = loadSettings();
  const preferredPreset = resolvePreset(defaults, { presetId: initial?.presetId, preset: initial?.preset });
  const systemPrompt = typeof preferredPreset?.systemPrompt === 'string'
    ? preferredPreset.systemPrompt
    : DEFAULT_SYSTEM_PROMPT;
  const systemVariant: MessageVariant = {
    id: 1,
    role: 'system',
    content: systemPrompt,
    time: Date.now(),
    typing: false,
    error: undefined,
    next: null
  };
  let baseNodes: ChatNode[] = [];
  let rootId: number | null = 1;
  if (Array.isArray(initial?.nodes)) {
    baseNodes = initial.nodes.slice();
    if (!baseNodes.length) {
      rootId = null;
    } else if (typeof initial?.rootId === 'number' && Number.isFinite(initial.rootId) && baseNodes.some((n) => n?.id === initial.rootId)) {
      rootId = initial.rootId;
    } else {
      rootId = baseNodes[0]?.id ?? null;
    }
  } else if (Array.isArray(initial?.messages)) {
    // Legacy: create one node per message with single variant, linear chain
    const now = Date.now();
    const cleaned = initial.messages.map((m, i) => ({
      id: m.id || (i + 1),
      role: m.role,
      content: m.content,
      time: m.time || now,
      typing: !!m.typing,
      error: m.error
    }));
    baseNodes = cleaned.map((m, i) => ({
      id: i + 1,
      variants: [{
        id: m.id,
        role: m.role as 'user' | 'assistant' | 'system' | 'tool',
        content: m.content,
        time: m.time || now,
        typing: !!m.typing,
        error: m.error,
        next: (i < cleaned.length - 1 ? (i + 2) : null)
      }],
      active: 0
    }));
    rootId = 1;
  } else {
    baseNodes = [{ id: 1, variants: [systemVariant], active: 0 }];
    rootId = 1;
  }
  const connectionOverride = (() => {
    if (initial?.settings && hasOwn(initial.settings, 'connectionId')) return initial.settings.connectionId;
    if (hasOwn(initial, 'connectionId')) return initial.connectionId;
    return undefined;
  })();
  const candidatePreset = {
    ...preferredPreset,
    connectionId: (() => {
      if (typeof connectionOverride === 'string' && connectionOverride.trim()) return connectionOverride.trim();
      return preferredPreset?.connectionId || null;
    })(),
  };
  const resolvedConnectionId = computeConnectionId({
    preset: candidatePreset,
    settings: defaults,
  });
  const chat: Chat = {
    id,
    title: initial?.title || computeTitleFromNodes(baseNodes, rootId),
    updatedAt: initial?.updatedAt || Date.now(),
    settings: {
      model: initial?.settings?.model || initial?.model || preferredPreset.model || 'gpt-5',
      streaming: (typeof initial?.settings?.streaming === 'boolean')
        ? initial.settings.streaming
        : (typeof preferredPreset.streaming === 'boolean' ? preferredPreset.streaming : true),
      maxOutputTokens: toIntOrNull(hasOwn(initial?.settings || {}, 'maxOutputTokens') ? initial.settings!.maxOutputTokens : preferredPreset.maxOutputTokens),
      topP: toClampedNumber(hasOwn(initial?.settings || {}, 'topP') ? initial.settings!.topP : preferredPreset.topP, 0, 1),
      temperature: toClampedNumber(hasOwn(initial?.settings || {}, 'temperature') ? initial.settings!.temperature : preferredPreset.temperature, 0, 2),
      reasoningEffort: normalizeReasoning(hasOwn(initial?.settings || {}, 'reasoningEffort') ? initial.settings!.reasoningEffort : preferredPreset.reasoningEffort),
      textVerbosity: normalizeVerbosity(hasOwn(initial?.settings || {}, 'textVerbosity') ? initial.settings!.textVerbosity : preferredPreset.textVerbosity),
      reasoningSummary: normalizeReasoningSummary(hasOwn(initial?.settings || {}, 'reasoningSummary') ? initial.settings!.reasoningSummary : preferredPreset.reasoningSummary),
      thinkingEnabled: (() => {
        if (hasOwn(initial?.settings || {}, 'thinkingEnabled')) {
          return !!initial.settings!.thinkingEnabled;
        }
        return !!preferredPreset.thinkingEnabled;
      })(),
      thinkingBudgetTokens: toIntOrNull(hasOwn(initial?.settings || {}, 'thinkingBudgetTokens') ? initial.settings!.thinkingBudgetTokens : preferredPreset.thinkingBudgetTokens),
      connectionId: resolvedConnectionId,
      // Web Search settings
      webSearchEnabled: hasOwn(initial?.settings || {}, 'webSearchEnabled') ? !!initial.settings!.webSearchEnabled : !!preferredPreset.webSearchEnabled,
      webSearchDomains: (hasOwn(initial?.settings || {}, 'webSearchDomains') ? initial.settings!.webSearchDomains : preferredPreset.webSearchDomains) || undefined,
      webSearchCountry: (hasOwn(initial?.settings || {}, 'webSearchCountry') ? initial.settings!.webSearchCountry : preferredPreset.webSearchCountry) || undefined,
      webSearchCity: (hasOwn(initial?.settings || {}, 'webSearchCity') ? initial.settings!.webSearchCity : preferredPreset.webSearchCity) || undefined,
      webSearchRegion: (hasOwn(initial?.settings || {}, 'webSearchRegion') ? initial.settings!.webSearchRegion : preferredPreset.webSearchRegion) || undefined,
      webSearchTimezone: (hasOwn(initial?.settings || {}, 'webSearchTimezone') ? initial.settings!.webSearchTimezone : preferredPreset.webSearchTimezone) || undefined,
      webSearchCacheOnly: hasOwn(initial?.settings || {}, 'webSearchCacheOnly') ? !!initial.settings!.webSearchCacheOnly : !!preferredPreset.webSearchCacheOnly,
      // Code Interpreter settings
      codeInterpreterEnabled: hasOwn(initial?.settings || {}, 'codeInterpreterEnabled') ? !!initial.settings!.codeInterpreterEnabled : !!preferredPreset.codeInterpreterEnabled,
      // Shell settings
      shellEnabled: hasOwn(initial?.settings || {}, 'shellEnabled') ? !!initial.settings!.shellEnabled : !!preferredPreset.shellEnabled,
      // Image Generation settings
      imageGenerationEnabled: hasOwn(initial?.settings || {}, 'imageGenerationEnabled') ? !!initial.settings!.imageGenerationEnabled : !!preferredPreset.imageGenerationEnabled,
      imageGenerationModel: (hasOwn(initial?.settings || {}, 'imageGenerationModel') ? initial.settings!.imageGenerationModel : preferredPreset.imageGenerationModel) || undefined,
    },
    nodes: baseNodes,
    rootId,
    presetId: (typeof initial?.presetId === 'string') ? initial.presetId : (preferredPreset?.id || null),
  };
  const persisted = await storePutAtomic(chat);
  const finalChat = persisted || chat;
  cacheChat(id, finalChat);
  setSelected(id);
  return { id, chat: finalChat };
}

export async function debugSetChatLockState(id: string, shouldLock: boolean = true): Promise<Chat | null> {
  if (!id) return null;
  try {
    return await storeUpdateAtomic(id, (chat) => {
      if (!chat) return undefined;
      let next = shouldLock ? applyChatLockState(chat) : sanitizeChatLockState(chat);
      if (!next) return undefined;
      if (next === chat) next = { ...next } as Chat;
      return {
        ...next,
        updatedAt: Date.now(),
      };
    });
  } catch {
    return null;
  }
}
