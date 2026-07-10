// Chat persistence: content sanitization, change-detection signatures,
// global write throttling, retry-on-failure, and parent refresh debouncing.
// Single owner of the "when and how do we save a chat" policy.
import { saveChatContent } from '../../chatsStore.js';
import { isConcurrencyConflict } from '../../storage.errors.js';
import { sanitizeGraphComprehensive } from './graphValidation.js';
import type { Chat, ChatNode, ChatSettings, PersistenceResult, PersistenceScheduler, ImageReference } from '../../types/index.js';

function sanitizeImages(images: unknown, stripData: boolean = false): ImageReference[] {
  if (!Array.isArray(images)) return [];
  const map = new Map<string, ImageReference & { data?: string }>();
  for (const entry of images) {
    if (entry == null) continue;
    let id: string | null = null;
    let mimeType: string | undefined;
    let name: string | undefined;
    let data: string | undefined;
    if (typeof entry === 'string') {
      id = entry.trim();
      if (!id) continue;
    } else if (typeof entry === 'object') {
      const entryObj = entry as Record<string, unknown>;
      id = typeof entryObj.id === 'string' && (entryObj.id as string).trim() ? (entryObj.id as string).trim() : null;
      if (!id) continue;
      if (typeof entryObj.mimeType === 'string' && (entryObj.mimeType as string).trim()) mimeType = (entryObj.mimeType as string).trim();
      if (typeof entryObj.name === 'string' && (entryObj.name as string).trim()) name = (entryObj.name as string).trim();
      if (!stripData && typeof entryObj.data === 'string' && entryObj.data) data = entryObj.data as string;
    } else {
      continue;
    }

    const existing = map.get(id);
    if (existing) {
      if (!existing.mimeType && mimeType) existing.mimeType = mimeType;
      if (!existing.name && name) existing.name = name;
      if (!(existing as { data?: string }).data && data) (existing as { data?: string }).data = data;
      continue;
    }

    const img: ImageReference & { data?: string } = { id };
    if (mimeType) img.mimeType = mimeType;
    if (name) img.name = name;
    if (!stripData && data) img.data = data;
    map.set(id, img);
  }
  return [...map.values()];
}

function sanitizeGeneratedImages(images: unknown): Array<ImageReference & { revisedPrompt?: string }> {
  if (!Array.isArray(images)) return [];
  const map = new Map<string, ImageReference & { revisedPrompt?: string }>();
  for (const entry of images) {
    if (!entry || typeof entry !== 'object') continue;
    const entryObj = entry as Record<string, unknown>;
    const id = typeof entryObj.id === 'string' && entryObj.id.trim() ? entryObj.id.trim() : null;
    if (!id) continue;

    const image: ImageReference & { revisedPrompt?: string } = { id };
    if (typeof entryObj.mimeType === 'string' && entryObj.mimeType.trim()) image.mimeType = entryObj.mimeType.trim();
    else image.mimeType = 'image/png';
    if (typeof entryObj.name === 'string' && entryObj.name.trim()) image.name = entryObj.name.trim();
    if (typeof entryObj.revisedPrompt === 'string' && entryObj.revisedPrompt) image.revisedPrompt = entryObj.revisedPrompt;

    const existing = map.get(id);
    if (existing) {
      if (!existing.mimeType && image.mimeType) existing.mimeType = image.mimeType;
      if (!existing.name && image.name) existing.name = image.name;
      if (!existing.revisedPrompt && image.revisedPrompt) existing.revisedPrompt = image.revisedPrompt;
      continue;
    }
    map.set(id, image);
  }
  return [...map.values()];
}

interface SanitizeResult {
  variant: unknown;
  changed: boolean;
}

function sanitizeVariantImages(variant: unknown): SanitizeResult {
  if (!variant || typeof variant !== 'object') return { variant, changed: false };
  const variantObj = variant as Record<string, unknown>;
  const imagesInput = variantObj.images;
  const normalized = sanitizeImages(imagesInput, true);
  const hasImages = normalized.length > 0;

  if (!Array.isArray(imagesInput)) {
    if (!hasImages && !('images' in variantObj)) return { variant, changed: false };
    const cleaned = { ...variantObj };
    if (hasImages) {
      cleaned.images = normalized;
    } else {
      delete cleaned.images;
    }
    return { variant: cleaned, changed: true };
  }

  const originalImages = imagesInput;

  if (!hasImages) {
    if (!originalImages.length) return { variant, changed: false };
    const cleaned = { ...variantObj };
    delete cleaned.images;
    return { variant: cleaned, changed: true };
  }

  let needsUpdate = originalImages.length !== normalized.length;
  if (!needsUpdate) {
    for (let i = 0; i < normalized.length; i++) {
      const orig = originalImages[i];
      const norm = normalized[i]!;
      const origId = typeof orig === 'string' ? orig.trim() : (orig && typeof orig === 'object' && typeof (orig as Record<string, unknown>).id === 'string' ? (orig as Record<string, unknown>).id as string : null);
      const origMime = (orig && typeof orig === 'object' && typeof (orig as Record<string, unknown>).mimeType === 'string') ? ((orig as Record<string, unknown>).mimeType as string).trim() : '';
      const origName = (orig && typeof orig === 'object' && typeof (orig as Record<string, unknown>).name === 'string') ? ((orig as Record<string, unknown>).name as string).trim() : '';
      const origHasData = !!(orig && typeof orig === 'object' && typeof (orig as Record<string, unknown>).data === 'string' && (orig as Record<string, unknown>).data);
      if (origId !== norm.id || origMime !== (norm.mimeType || '') || origName !== (norm.name || '') || origHasData) {
        needsUpdate = true;
        break;
      }
    }
  }

  if (!needsUpdate) return { variant, changed: false };
  return { variant: { ...variantObj, images: normalized }, changed: true };
}

function sanitizeVariantGeneratedImages(variant: unknown): SanitizeResult {
  if (!variant || typeof variant !== 'object') return { variant, changed: false };
  const variantObj = variant as Record<string, unknown>;
  const imagesInput = variantObj.generatedImages;
  const normalized = sanitizeGeneratedImages(imagesInput);
  const hasImages = normalized.length > 0;

  if (!Array.isArray(imagesInput)) {
    if (!hasImages && !('generatedImages' in variantObj)) return { variant, changed: false };
    const cleaned = { ...variantObj };
    if (hasImages) cleaned.generatedImages = normalized;
    else delete cleaned.generatedImages;
    return { variant: cleaned, changed: true };
  }

  if (!hasImages) {
    if (!imagesInput.length) return { variant, changed: false };
    const cleaned = { ...variantObj };
    delete cleaned.generatedImages;
    return { variant: cleaned, changed: true };
  }

  let needsUpdate = imagesInput.length !== normalized.length;
  if (!needsUpdate) {
    for (let i = 0; i < normalized.length; i++) {
      const orig = imagesInput[i];
      const norm = normalized[i]!;
      const obj = orig && typeof orig === 'object' ? orig as Record<string, unknown> : null;
      const origId = typeof obj?.id === 'string' ? obj.id : '';
      const origMime = typeof obj?.mimeType === 'string' ? obj.mimeType.trim() : '';
      const origName = typeof obj?.name === 'string' ? obj.name.trim() : '';
      const origPrompt = typeof obj?.revisedPrompt === 'string' ? obj.revisedPrompt : '';
      const origHasData = typeof obj?.data === 'string' && !!obj.data;
      if (origId !== norm.id || origMime !== (norm.mimeType || '') || origName !== (norm.name || '') || origPrompt !== (norm.revisedPrompt || '') || origHasData) {
        needsUpdate = true;
        break;
      }
    }
  }

  if (!needsUpdate) return { variant, changed: false };
  return { variant: { ...variantObj, generatedImages: normalized }, changed: true };
}

function stripImageDataFromNodes(nodes: ChatNode[]): ChatNode[] {
  const list = Array.isArray(nodes) ? nodes : [];
  let mutated = false;
  const sanitizedNodes = list.map((node) => {
    if (!node || typeof node !== 'object') return node;
    const variants = Array.isArray(node.variants) ? node.variants : [];
    let variantsChanged = false;
    const sanitizedVariants = variants.map(variant => {
      const imageResult = sanitizeVariantImages(variant);
      const generatedResult = sanitizeVariantGeneratedImages(imageResult.variant);
      if (imageResult.changed || generatedResult.changed) variantsChanged = true;
      return generatedResult.variant;
    });
    if (!variantsChanged) return node;
    mutated = true;
    return { ...node, variants: sanitizedVariants } as ChatNode;
  });
  return mutated ? sanitizedNodes : nodes;
}

/**
 * Simple hash function for strings (djb2 algorithm)
 * Provides fast, deterministic hashing for content comparison
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

function mixHash(hash: number, value: number): number {
  return ((hash << 5) + hash) ^ value;
}

function hashMaybeString(value: unknown): number {
  return typeof value === 'string' && value ? hashString(value) : 0;
}

function hashImages(images: unknown): number {
  const normalized = sanitizeImages(images, true);
  let hash = 5381;
  for (const img of normalized) {
    hash = mixHash(hash, hashString(`${img.id}|${img.mimeType || ''}|${img.name || ''}`));
  }
  return hash >>> 0;
}

function hashGeneratedImages(images: unknown): number {
  const list = Array.isArray(images) ? images : [];
  let hash = 5381;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : '';
    const mimeType = typeof obj.mimeType === 'string' ? obj.mimeType : '';
    const name = typeof obj.name === 'string' ? obj.name : '';
    const revisedPromptHash = typeof obj.revisedPrompt === 'string' ? hashString(obj.revisedPrompt) : 0;
    hash = mixHash(hash, hashString(id));
    hash = mixHash(hash, hashString(mimeType));
    hash = mixHash(hash, hashString(name));
    hash = mixHash(hash, revisedPromptHash);
  }
  return hash >>> 0;
}

function hashMcpItems(items: unknown): number {
  const list = Array.isArray(items) ? items : [];
  let hash = 5381;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    hash = mixHash(hash, hashMaybeString(obj.type));
    hash = mixHash(hash, hashMaybeString(obj.id));
    hash = mixHash(hash, hashMaybeString(obj.serverLabel));
    hash = mixHash(hash, hashMaybeString(obj.name));
    hash = mixHash(hash, hashMaybeString(obj.arguments));
    hash = mixHash(hash, hashMaybeString(obj.output));
    hash = mixHash(hash, hashMaybeString(obj.error));
    hash = mixHash(hash, hashMaybeString(obj.status));
    if (Array.isArray(obj.tools)) {
      for (const tool of obj.tools as Array<Record<string, unknown>>) {
        hash = mixHash(hash, hashString(`${typeof tool?.name === 'string' ? tool.name : ''}|${typeof tool?.description === 'string' ? tool.description : ''}`));
      }
    }
  }
  return hash >>> 0;
}

function hashVariant(variant: unknown): number {
  if (!variant || typeof variant !== 'object') return 0;
  const v = variant as Record<string, unknown>;
  let hash = 5381;
  hash = mixHash(hash, Number(v.id) || 0);
  hash = mixHash(hash, hashMaybeString(v.role));
  hash = mixHash(hash, hashMaybeString(v.content));
  hash = mixHash(hash, v.next == null ? 0 : (Number(v.next) || 0));
  hash = mixHash(hash, v.typing === true ? 1 : 0);
  hash = mixHash(hash, hashMaybeString(v.error));
  hash = mixHash(hash, hashMaybeString(v.reasoningSummary));
  hash = mixHash(hash, v.reasoningSummaryLoading === true ? 1 : 0);
  hash = mixHash(hash, hashImages(v.images));
  hash = mixHash(hash, hashGeneratedImages(v.generatedImages));
  hash = mixHash(hash, hashMcpItems(v.mcpItems));
  return hash >>> 0;
}

/**
 * Computes a content-aware signature for persistence change detection.
 * Uses actual content hashes instead of just lengths to detect same-length edits.
 */
export function computePersistSig(nodes: ChatNode[], chatSettings: ChatSettings, rootId: number | null): string {
  try {
    const list = Array.isArray(nodes) ? nodes : [];
    const mini = list
      .slice()
      .sort((a, b) => (Number(a?.id) || 0) - (Number(b?.id) || 0))
      .map(n => {
        const variants = Array.isArray(n?.variants) ? n.variants : [];
        const activeIdx = Math.max(0, Math.min(variants.length - 1, Number(n?.active) || 0));
        let nodeHash = 5381;
        for (const v of variants) {
          nodeHash = mixHash(nodeHash, hashVariant(v));
        }
        nodeHash = mixHash(nodeHash, activeIdx);
        nodeHash = mixHash(nodeHash, variants.length);
        return `${n.id}|${activeIdx}|${variants.length}|${(nodeHash >>> 0)}`;
      });
    return JSON.stringify({
      m: mini,
      settings: {
        model: chatSettings?.model || '',
        streaming: !!chatSettings?.streaming,
        presetId: chatSettings?.presetId || '',
        maxOutputTokens: chatSettings?.maxOutputTokens ?? null,
        topP: chatSettings?.topP ?? null,
        temperature: chatSettings?.temperature ?? null,
        reasoningEffort: chatSettings?.reasoningEffort || '',
        textVerbosity: chatSettings?.textVerbosity || '',
        reasoningSummary: chatSettings?.reasoningSummary || '',
        thinkingEnabled: !!chatSettings?.thinkingEnabled,
        thinkingBudgetTokens: chatSettings?.thinkingBudgetTokens ?? null,
        connectionId: chatSettings?.connectionId || '',
        // Web Search settings
        webSearchEnabled: !!chatSettings?.webSearchEnabled,
        webSearchDomains: chatSettings?.webSearchDomains || '',
        webSearchCountry: chatSettings?.webSearchCountry || '',
        webSearchCity: chatSettings?.webSearchCity || '',
        webSearchRegion: chatSettings?.webSearchRegion || '',
        webSearchTimezone: chatSettings?.webSearchTimezone || '',
        webSearchCacheOnly: !!chatSettings?.webSearchCacheOnly,
        // Code Interpreter settings
        codeInterpreterEnabled: !!chatSettings?.codeInterpreterEnabled,
        // Shell settings
        shellEnabled: !!chatSettings?.shellEnabled,
        // Image Generation settings
        imageGenerationEnabled: !!chatSettings?.imageGenerationEnabled,
        imageGenerationModel: chatSettings?.imageGenerationModel || '',
        // MCP settings
        mcpEnabled: !!chatSettings?.mcpEnabled,
        mcpServers: JSON.stringify(Array.isArray(chatSettings?.mcpServers) ? chatSettings.mcpServers : []),
      },
      rootId,
    });
  } catch (err) {
    // Fail safe: return a unique-per-call value so change detection always
    // sees a difference and persistence keeps happening.
    console.error('computePersistSig failed:', err);
    return `err:${Date.now()}:${Math.random()}`;
  }
}

// ============================================================================
// Global persistence throttle - limits how often persistence can occur across
// all chats. This prevents storage write storms when multiple chats are active.
// ============================================================================

const GLOBAL_THROTTLE_MS = 50;
let globalPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersists: Map<string, () => Promise<void>> = new Map();

/**
 * Queue a persist operation with global throttling
 * Only the latest persist for each chatId is kept
 */
export function queueGlobalPersist(chatId: string, persistFn: () => Promise<void>): void {
  pendingPersists.set(chatId, persistFn);

  if (globalPersistTimer) return;

  globalPersistTimer = setTimeout(async () => {
    globalPersistTimer = null;
    const batch = pendingPersists;
    pendingPersists = new Map();

    // Execute all pending persists in parallel
    const tasks = Array.from(batch.values()).map(fn => {
      try { return fn(); } catch { return Promise.resolve(); }
    });
    await Promise.allSettled(tasks);
  }, GLOBAL_THROTTLE_MS);
}

/**
 * Flush any pending global persists immediately.
 * Useful on teardown to avoid losing the last throttled write.
 */
export async function flushGlobalPersists(): Promise<void> {
  if (globalPersistTimer) {
    clearTimeout(globalPersistTimer);
    globalPersistTimer = null;
  }

  const batch = pendingPersists;
  if (!batch.size) return;
  pendingPersists = new Map();

  const tasks = Array.from(batch.values()).map(fn => {
    try { return fn(); } catch { return Promise.resolve(); }
  });
  await Promise.allSettled(tasks);
}

/**
 * Creates a persistence scheduler for handling refresh callbacks
 * Uses debounce behavior - latest callback payload wins while pending.
 */
export function createPersistenceScheduler(): PersistenceScheduler {
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingCallback: ((updated?: Chat) => void) | undefined;
  let pendingUpdated: Chat | null | undefined;

  function scheduleRefresh(
    callback: ((updated?: Chat) => void) | undefined,
    updated?: Chat | null
  ): void {
    if (!callback || typeof callback !== 'function') return;

    pendingCallback = callback;
    pendingUpdated = updated;

    if (refreshTimer) {
      return;
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const cb = pendingCallback;
      const payload = pendingUpdated;
      pendingCallback = undefined;
      pendingUpdated = undefined;
      try {
        cb?.(payload ?? undefined);
      } catch {
        // Ignore callback errors
      }
    }, 0);
  }

  function cancel(): void {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    pendingCallback = undefined;
    pendingUpdated = undefined;
  }

  return {
    scheduleRefresh,
    cancel,
  };
}

export async function persistChatContent(
  chatId: string,
  nodes: ChatNode[],
  chatSettings: ChatSettings,
  rootId: number | null,
  debug: boolean,
  mounted: boolean
): Promise<PersistenceResult> {
  if (!chatId || !mounted) return { updated: null, notice: '', nodes, rootId };

  try {
    // Comprehensive sanitization: fix active indices, rootId, and multiple parents
    const sanitizeResult = sanitizeGraphComprehensive(nodes, rootId, debug);
    const { nodes: sanitized, rootId: sanitizedRootId, notice } = sanitizeResult;

    const cleanedNodes = stripImageDataFromNodes(sanitized);

    // Persist full graph
    const updated = await saveChatContent(chatId, {
      nodes: cleanedNodes,
      settings: chatSettings,
      rootId: sanitizedRootId
    });

    const finalNodes = (updated && Array.isArray(updated.nodes)) ? updated.nodes : cleanedNodes;
    const finalRootId = updated ? updated.rootId : sanitizedRootId;

    return { updated, notice, nodes: finalNodes, rootId: finalRootId };
  } catch (err) {
    throw err;
  }
}

// ============================================================================
// Chat persister: owns signature tracking, throttled scheduling, retries and
// parent refresh debouncing for a single chat component.
// ============================================================================

export interface ChatSnapshot {
  nodes: ChatNode[];
  chatSettings: ChatSettings;
  rootId: number | null;
  debug: boolean;
}

export interface ChatPersisterHost {
  getChatId(): string | null;
  getState(): ChatSnapshot;
  /** True when this chat's content is loaded and the component is alive. */
  canPersist(): boolean;
  isDestroyed(): boolean;
  /** True while a generation is streaming (auto-persist stays quiet). */
  isBusy(): boolean;
  /** Called when persistence sanitized the graph (autofix notice). */
  onSanitized(result: PersistenceResult): void;
  /** Debounced notification that the stored chat changed. */
  onChatUpdated(updated: Chat | null): void;
  /** A concurrent modification from another tab was detected. */
  onConflict(): void;
  /** A non-conflict save error occurred. */
  onSaveError(message: string): void;
}

export interface ChatPersister {
  /** Persist if the content signature changed (throttled). Safe to call from effects. */
  requestPersist(): void;
  /** Persist immediately (still guarded by host.canPersist()). */
  persistNow(): Promise<void>;
  /** Marks the given signature as already persisted (after load). */
  markPersisted(sig: string): void;
  /** Clears signature state (before loading another chat). */
  reset(): void;
  /** Cancels pending timers/refreshes. */
  cancel(): void;
  /** Best-effort flush of a snapshot during unmount. */
  flushForUnmount(chatId: string, snapshot: ChatSnapshot): void;
  isInFlight(): boolean;
}

const PERSIST_RETRY_MS = 750;

export function createChatPersister(host: ChatPersisterHost): ChatPersister {
  let persistedSig = '';
  let scheduledPersistSig = '';
  let inFlight = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const refreshScheduler = createPersistenceScheduler();

  function clearRetry(): void {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry(delayMs: number = PERSIST_RETRY_MS): void {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      const cid = host.getChatId();
      if (!cid || !host.canPersist() || host.isDestroyed()) return;
      try {
        const s = host.getState();
        const desired = computePersistSig(s.nodes, s.chatSettings, s.rootId);
        if (desired === persistedSig) return;
        // Force a new schedule attempt even if we previously "scheduled" this sig.
        scheduledPersistSig = '';
        queueGlobalPersist(cid, async () => {
          await persistNow();
        });
      } catch { /* ignore */ }
    }, delayMs);
  }

  async function persistNow(): Promise<void> {
    const cid = host.getChatId();
    if (!cid || !host.canPersist()) return;
    inFlight += 1;
    try {
      const s = host.getState();
      const result = await persistChatContent(cid, s.nodes, s.chatSettings, s.rootId, s.debug, true);
      if (host.isDestroyed()) return;
      if (result.notice) {
        // Only update host state if sanitization actually made corrections
        host.onSanitized(result);
      }
      const after = host.getState();
      persistedSig = computePersistSig(after.nodes, after.chatSettings, after.rootId);
      scheduledPersistSig = persistedSig;
      clearRetry();
      refreshScheduler.scheduleRefresh((updated) => host.onChatUpdated(updated ?? null), result.updated);
    } catch (err) {
      if (host.isDestroyed()) return;
      if (isConcurrencyConflict(err)) {
        host.onConflict();
        scheduledPersistSig = persistedSig;
        return;
      }
      host.onSaveError((err as Error)?.message || '');
      scheduledPersistSig = persistedSig;
      scheduleRetry();
    } finally {
      inFlight = Math.max(0, inFlight - 1);
      // Content may have changed while this persist was in flight; the
      // request path skips while inFlight > 0, so re-check here.
      if (inFlight === 0) {
        try { requestPersist(); } catch { /* ignore */ }
      }
    }
  }

  function requestPersist(): void {
    const cid = host.getChatId();
    if (!cid || !host.canPersist() || host.isBusy() || inFlight > 0) return;
    try {
      const s = host.getState();
      const sig = computePersistSig(s.nodes, s.chatSettings, s.rootId);
      if (sig === persistedSig || sig === scheduledPersistSig) return;
      scheduledPersistSig = sig;
      // Use global throttle to prevent storage write storms across multiple chats
      queueGlobalPersist(cid, async () => {
        await persistNow();
      });
    } catch { /* ignore */ }
  }

  return {
    requestPersist,
    persistNow,
    markPersisted(sig: string): void {
      persistedSig = sig;
      scheduledPersistSig = sig;
    },
    reset(): void {
      persistedSig = '';
      scheduledPersistSig = '';
    },
    cancel(): void {
      clearRetry();
      refreshScheduler.cancel();
    },
    flushForUnmount(chatId: string, snapshot: ChatSnapshot): void {
      try {
        const sig = computePersistSig(snapshot.nodes, snapshot.chatSettings, snapshot.rootId);
        if (sig && sig !== persistedSig) {
          queueGlobalPersist(chatId, async () => {
            await persistChatContent(chatId, snapshot.nodes, snapshot.chatSettings, snapshot.rootId, snapshot.debug, true);
          });
          void flushGlobalPersists();
        }
      } catch { /* ignore */ }
    },
    isInFlight(): boolean {
      return inFlight > 0;
    },
  };
}
