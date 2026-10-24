// Per-chat controller (Svelte 5 runes class).
//
// Owns one chat's conversation graph and everything that changes it: loading,
// edits, branching, variant switching, generation and persistence. Chat.svelte
// only renders the controller's state and forwards user intent to it, so chat
// behavior can be exercised without mounting any UI.
//
// Reactive inputs (settings, the shared character card) are pushed in by the
// host component's effects via the sync* methods.

import { untrack } from 'svelte';
import { findConnection } from '../settingsStore.js';
import { debugSetChatLockState } from '../chatsStore.js';
import { ChatImageManager } from './imageManager.svelte.js';
import { loadChat } from './services/chatLoader.js';
import { applyPresetToChatSettings } from '../utils/presetHelpers.js';
import { pickPresetFromSettings } from './services/chatInit.js';
import { getCharacter } from '../tavern/charactersStore.js';
import { buildPromptInjections, resolvePromptPreset } from '../tavern/promptPresets.js';
import { resolveTavernPresetId } from '../tavern/tavernPreset.js';
import { createChatPersister, type ChatPersister } from './services/chatPersistence.js';
import { computeValidationNotice, computeGenerationNotice, assembleNotice, computeFollowingMap } from './services/noticeHelpers.js';
import { resolveConnectionContext } from './services/connectionResolver.js';
import { createGenerationLifecycle, type GenerationLifecycle, type GenerationRun, type GenerationSnapshot } from './services/generationLifecycle.js';
import { validateChatEdit } from './services/chatEditGuard.js';
import { applyDebugLockToNodes, clearDebugLockFromNodes } from './services/debugLock.js';
import { deleteMessage, setMessageRole, moveUp, moveDown } from './actions/messageActions.js';
import { changeVariant, updateVariantById } from './actions/variantActions.js';
import { commitEditReplace, applyEditBranch, prepareBranchAndSend, insertMessageBetween } from './actions/editActions.js';
import {
  prepareUserMessage,
  prepareTypingNode,
  generateResponse,
  handleGenerationSuccess,
  handleGenerationError,
  prepareRefreshAssistant,
  prepareRefreshAfterUser,
  validateTypingVariantVisible,
  logGenerationEvent,
} from './actions/generationActions.js';
import { deepClone } from '../utils/immutable.js';
import { NO_API_KEY_NOTICE_TEXT } from '../constants/index.js';
import { buildVisible } from '../branching.js';
import { findNodeByMessageId } from '../utils/treeUtils.js';
import { isStorageUnavailable } from '../storage.errors.js';
import type { Node, Message, Chat, ChatSettings, AppSettings, ImageRef, MessageRole, Preset } from '../types/index.js';
import type { Character } from '../types/tavern.js';

export type ChatLoadStatus = 'loading' | 'ready' | 'error';

/** Minimal registry surface (see stores/appState.svelte.ts). */
export interface GenerationRegistryLike {
  setGenerating(chatId: string, isGenerating: boolean): void;
}

export interface ChatControllerOptions {
  chatId: string;
  initialSettings: AppSettings;
  registry: GenerationRegistryLike;
  /** Persists app-wide settings (Tavern preset write-back). */
  saveSettings?: (next: AppSettings) => void;
  /** The shared character card for this chat, kept live by the app shell. */
  getTavernCharacter?: () => Character | null | undefined;
  onChatUpdated?: (updated?: Chat) => void;
  scrollToBottom?: () => void;
}

type ChatDraft = { nodes: Node[]; rootId: number | null; nextId: number; nextNodeId: number };

interface MutationOptions {
  allowDelete?: boolean;
  requireVisibleVariantIds?: number[] | (() => number[]);
}

function normalizeEditableText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
}

function hasTypingVariant(nodes: Node[]): boolean {
  return Array.isArray(nodes) && nodes.some(n => (n?.variants || []).some(v => v?.typing));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err || '');
}

/** Appends a message after the last visible message (or as the root). */
function appendNode(draft: ChatDraft, role: string, content: string, images: ImageRef[]): { draft: ChatDraft; nodeId: number } {
  const variant: Message = {
    id: draft.nextId,
    role: role as MessageRole,
    content,
    time: Date.now(),
    typing: false,
    error: undefined,
    next: null,
    images: images.length ? images : undefined,
  };
  const node: Node = { id: draft.nextNodeId, variants: [variant], active: 0 };
  const lastVm = buildVisible(draft.nodes, draft.rootId).at(-1);

  let nodes = [...draft.nodes, node];
  let rootId = draft.rootId;
  if (lastVm) {
    nodes = nodes.map(n => {
      if (n.id !== lastVm.nodeId) return n;
      const activeIndex = Math.max(0, Math.min((n.variants?.length || 1) - 1, Number(n.active) || 0));
      return { ...n, variants: n.variants.map((v, i) => (i === activeIndex ? { ...v, next: node.id } : v)) };
    });
  } else {
    rootId = node.id;
  }

  return {
    draft: { nodes, rootId, nextId: draft.nextId + 1, nextNodeId: draft.nextNodeId + 1 },
    nodeId: node.id,
  };
}

export class ChatController {
  // ---- Identity & load state -------------------------------------------
  chatId = $state('');
  status = $state<ChatLoadStatus>('loading');
  loadError = $state('');

  // ---- Conversation graph ----------------------------------------------
  nodes = $state<Node[]>([]);
  rootId = $state<number | null>(1);
  nextId = $state(1);
  nextNodeId = $state(1);

  // ---- Configuration -----------------------------------------------------
  settings = $state<AppSettings>({} as AppSettings);
  debug = $state(false);
  chatSettings = $state<ChatSettings>({} as ChatSettings);
  characterId = $state<string | null>(null);
  character = $state<Character | null>(null);

  // ---- Composer & editing -----------------------------------------------
  input = $state('');
  editingId = $state<number | null>(null);
  editingText = $state('');
  insertedMessageId = $state<number | null>(null);
  forcedLock = $state(false);

  // ---- Notices -----------------------------------------------------------
  /** Reverted edits and autofix messages. */
  sanitizerNotice = $state('');
  /** Save failures; cleared by the next successful save. */
  saveNotice = $state('');
  missingApiKeyNotice = $state('');
  dismissedNotice = $state('');

  // ---- Generation ----------------------------------------------------------
  generation = $state<GenerationSnapshot>({ phase: 'idle', sequence: null, typingVariantId: null, chatId: null });

  // ---- Derived -------------------------------------------------------------
  readonly sending = $derived(this.generation.phase === 'generating');
  readonly locked = $derived(
    this.status !== 'ready' || this.forcedLock || this.sending || hasTypingVariant(this.nodes)
  );
  readonly visibleMessages = $derived(buildVisible(this.nodes, this.rootId));
  readonly followingMap = $derived(computeFollowingMap(this.nodes, this.rootId));
  readonly assembledNotice = $derived(assembleNotice(
    computeGenerationNotice(this.nodes, this.rootId),
    [this.saveNotice, this.sanitizerNotice].filter(Boolean).join(' '),
    computeValidationNotice(this.nodes, this.rootId, this.debug),
    this.missingApiKeyNotice,
    this.dismissedNotice,
  ));
  readonly visibleNotice = $derived(
    this.assembledNotice && this.assembledNotice !== this.dismissedNotice ? this.assembledNotice : ''
  );

  readonly images = new ChatImageManager();

  private readonly options: ChatControllerOptions;
  private readonly lifecycle: GenerationLifecycle;
  private readonly persister: ChatPersister;
  private loadedChatId: string | null = null;
  private loadToken = 0;
  private destroyed = false;
  private appliedTavernPresetSig = '';

  constructor(options: ChatControllerOptions) {
    this.options = options;
    this.chatId = options.chatId;
    this.settings = options.initialSettings;
    this.debug = !!options.initialSettings?.debug;
    this.chatSettings = this.initialChatSettings(options.initialSettings);

    this.lifecycle = createGenerationLifecycle({
      onChange: (next, previous) => {
        this.generation = next;
        const chatId = next.chatId ?? previous.chatId;
        if (chatId) {
          try { options.registry.setGenerating(chatId, next.phase === 'generating'); } catch { /* ignore */ }
        }
      },
    });

    this.persister = createChatPersister({
      getChatId: () => this.chatId || null,
      getState: () => ({ nodes: this.nodes, chatSettings: this.chatSettings, rootId: this.rootId, debug: this.debug }),
      canPersist: () => !!this.chatId && !this.destroyed && this.status === 'ready' && this.loadedChatId === this.chatId,
      isDestroyed: () => this.destroyed,
      isBusy: () => this.sending || hasTypingVariant(this.nodes),
      onSanitized: (result) => {
        this.sanitizerNotice = result.notice;
        if (result.nodes !== this.nodes) this.nodes = result.nodes;
        if (result.rootId !== this.rootId) this.rootId = result.rootId;
      },
      onSaved: () => {
        this.saveNotice = '';
      },
      onChatUpdated: (updated) => {
        try { this.options.onChatUpdated?.(updated ?? undefined); } catch { /* ignore */ }
      },
      onConflict: () => {
        this.saveNotice = 'Failed to save: this chat was modified in another tab. Reload the page to sync.';
      },
      onSaveError: (msg) => {
        this.saveNotice = msg ? `Failed to save chat: ${msg}` : 'Failed to save chat.';
      },
    });
  }

  private initialChatSettings(settings: AppSettings): ChatSettings {
    const preset = pickPresetFromSettings(settings);
    const presetConn = typeof preset?.connectionId === 'string' && preset.connectionId.trim() ? preset.connectionId.trim() : null;
    const settingsConn = typeof settings?.selectedConnectionId === 'string' && settings.selectedConnectionId.trim()
      ? settings.selectedConnectionId.trim()
      : null;
    return {
      model: preset.model,
      streaming: preset.streaming,
      presetId: preset.id,
      maxOutputTokens: preset.maxOutputTokens,
      topP: preset.topP,
      temperature: preset.temperature,
      reasoningEffort: preset.reasoningEffort,
      textVerbosity: preset.textVerbosity,
      reasoningSummary: preset.reasoningSummary,
      openRouterProvider: preset.openRouterProvider || '',
      thinkingEnabled: preset.thinkingEnabled,
      thinkingBudgetTokens: preset.thinkingBudgetTokens,
      connectionId: presetConn ?? settingsConn,
      mcpEnabled: !!preset.mcpEnabled,
      mcpServers: preset.mcpServers || [],
    } as ChatSettings;
  }

  // ========================================================================
  // Loading
  // ========================================================================

  /** Loads (or reloads) a chat. Storage failures leave the chat in 'error'. */
  async load(chatId: string = this.chatId): Promise<void> {
    if (this.loadedChatId === chatId && this.status === 'ready') return;
    const token = ++this.loadToken;
    this.chatId = chatId;
    this.status = 'loading';
    this.loadError = '';
    this.forcedLock = false;
    this.persister.reset();
    if (!chatId) return;

    try {
      const result = await loadChat(chatId);
      if (token !== this.loadToken || this.destroyed) return;
      this.settings = result.settings;
      this.nodes = this.images.sanitizeNodesImageData(result.nodes);
      this.nextId = result.nextId;
      this.nextNodeId = result.nextNodeId;
      this.chatSettings = result.chatSettings;
      this.rootId = result.rootId;
      this.characterId = result.characterId || null;
      const shared = this.options.getTavernCharacter?.() ?? null;
      this.character = shared?.id === result.characterId ? shared : null;
      if (result.characterId && !this.character) void this.loadCharacter(result.characterId, token);
      this.clearEditState();
      this.dismissedNotice = '';
      this.persister.markPersisted(result.persistSig);
      this.loadedChatId = chatId;
      this.status = 'ready';
    } catch (err) {
      if (token !== this.loadToken || this.destroyed) return;
      this.loadedChatId = null;
      this.loadError = isStorageUnavailable(err)
        ? errorMessage(err)
        : `Could not load this chat: ${errorMessage(err) || 'unknown error'}`;
      this.status = 'error';
    }
  }

  /** Retries a failed load. */
  retryLoad(): Promise<void> {
    this.loadedChatId = null;
    return this.load(this.chatId);
  }

  private async loadCharacter(characterId: string, token: number): Promise<void> {
    try {
      const loaded = await getCharacter(characterId);
      if (token !== this.loadToken || this.characterId !== characterId) return;
      const shared = this.options.getTavernCharacter?.() ?? null;
      this.character = shared?.id === characterId ? shared : loaded;
    } catch { /* character cards are optional context */ }
  }

  // ========================================================================
  // Reactive inputs (called from the host component's effects)
  // ========================================================================

  syncSettings(next: AppSettings | null | undefined): void {
    if (!next) return;
    untrack(() => {
      this.settings = next;
      this.debug = !!next.debug;
      if (!this.debug && this.forcedLock) void this.setDebugLock(false);
    });
  }

  syncCharacter(shared: Character | null | undefined): void {
    if (this.characterId && shared?.id === this.characterId) {
      untrack(() => { this.character = shared; });
    }
  }

  /** Tavern chats follow the tavern preset selection and its contents. */
  followTavernPreset(current: AppSettings | null | undefined): void {
    if (!this.characterId || !current) return;
    if (current.tavernPerChatPresets) return;
    const selectedId = resolveTavernPresetId(current);
    if (!selectedId) return;
    const preset = (current.presets || []).find(p => p?.id === selectedId);
    if (!preset) return;
    const sig = JSON.stringify(preset);
    if (this.chatSettings?.presetId === selectedId && sig === this.appliedTavernPresetSig) return;
    this.appliedTavernPresetSig = sig;
    // Automatic Tavern sync preserves the saved per-chat provider override.
    untrack(() => this.selectPreset(preset, false));
  }

  /** Falls back to an existing connection when the chat's one was removed. */
  ensureValidConnection(): void {
    const list = Array.isArray(this.settings?.connections) ? this.settings.connections : [];
    if (!list.length) return;
    const ids = new Set(list.map(conn => conn?.id).filter(Boolean));
    const current = this.chatSettings?.connectionId;
    if (current && ids.has(current)) return;
    const fallback = findConnection(this.settings, current)?.id || list[0]?.id || null;
    if (fallback && fallback !== current) {
      this.chatSettings = { ...this.chatSettings, connectionId: fallback };
    }
  }

  /** Auto-save: tracks graph content when called from an effect. */
  autoPersist(): void {
    if (this.status !== 'ready' || this.loadedChatId !== this.chatId) return;
    if (this.sending || hasTypingVariant(this.nodes)) return;
    // The persister dedupes via content signatures; computing the signature
    // deep-reads nodes/chatSettings/rootId so a calling effect tracks them.
    this.persister.requestPersist();
  }

  persistNow(): Promise<void> {
    return this.persister.persistNow();
  }

  /** Stops generation and flushes pending changes. Call on unmount. */
  dispose(): void {
    if (this.destroyed) return;
    const chatId = this.chatId;
    const generatingChat = this.generation.chatId;
    // Keep the partial reply as a finished message rather than flushing it
    // to storage mid-"typing".
    this.stopRun();
    this.lifecycle.dispose();
    this.destroyed = true;
    for (const id of new Set([chatId, generatingChat])) {
      if (id) {
        try { this.options.registry.setGenerating(id, false); } catch { /* ignore */ }
      }
    }
    this.persister.cancel();
    if (!chatId || this.status !== 'ready' || this.loadedChatId !== chatId) return;
    try {
      this.persister.flushForUnmount(chatId, {
        nodes: deepClone(this.nodes),
        chatSettings: { ...this.chatSettings },
        rootId: this.rootId,
        debug: this.debug,
      });
    } catch { /* best effort */ }
  }

  // ========================================================================
  // Notices
  // ========================================================================

  dismissNotice(): void {
    this.dismissedNotice = this.assembledNotice;
  }

  private showMissingApiKeyNotice(): void {
    if (this.dismissedNotice && this.dismissedNotice.includes(NO_API_KEY_NOTICE_TEXT)) {
      this.dismissedNotice = '';
    }
    this.missingApiKeyNotice = NO_API_KEY_NOTICE_TEXT;
  }

  private resolveConnection(): { connectionId: string | null; apiKey: string } {
    const result = resolveConnectionContext(this.settings, this.chatSettings?.connectionId);
    this.settings = result.latestSettings;
    if (result.apiKey) this.missingApiKeyNotice = '';
    else this.showMissingApiKeyNotice();
    return { connectionId: result.connectionId, apiKey: result.apiKey };
  }

  // ========================================================================
  // Graph mutations
  // ========================================================================

  /**
   * Applies a mutation, validating the result with the edit guard and
   * reverting (with a notice) if it would corrupt the graph.
   */
  private mutate(label: string, mutation: (draft: ChatDraft) => ChatDraft, options: MutationOptions = {}): boolean {
    const before: ChatDraft = {
      nodes: deepClone(this.nodes),
      rootId: this.rootId,
      nextId: this.nextId,
      nextNodeId: this.nextNodeId,
    };

    let after: ChatDraft;
    try {
      after = mutation({ nodes: this.nodes, rootId: this.rootId, nextId: this.nextId, nextNodeId: this.nextNodeId });
    } catch {
      this.sanitizerNotice = `Reverted ${label}: unexpected error during edit.`;
      return false;
    }

    const guard = validateChatEdit(before, after, {
      label,
      allowDelete: options.allowDelete,
      debug: this.debug,
      requireVisibleVariantIds: options.requireVisibleVariantIds,
    });

    const applied = guard.ok ? after : before;
    this.nodes = applied.nodes;
    this.rootId = applied.rootId;
    this.nextId = applied.nextId;
    this.nextNodeId = applied.nextNodeId;
    if (!guard.ok && guard.notice) this.sanitizerNotice = guard.notice;
    return guard.ok;
  }

  private mutateAndSave(label: string, mutation: (draft: ChatDraft) => ChatDraft, options?: MutationOptions): boolean {
    const ok = this.mutate(label, mutation, options);
    if (ok) void this.persistNow();
    return ok;
  }

  private updateVariant(variantId: number, transform: (prev: Message) => Message): void {
    this.nodes = updateVariantById(this.nodes, variantId, transform);
  }

  deleteMessage(messageId: number): void {
    if (this.locked) return;
    this.mutateAndSave(`delete message ${messageId}`, (draft) => {
      const result = deleteMessage(draft.nodes, draft.rootId, messageId);
      return { ...draft, nodes: result.nodes, rootId: result.rootId };
    }, { allowDelete: true });
  }

  setRole(messageId: number, role: MessageRole): void {
    if (this.locked) return;
    this.mutateAndSave(`set role ${messageId}`, (draft) => ({ ...draft, nodes: setMessageRole(draft.nodes, messageId, role) }));
  }

  moveUp(messageId: number): void {
    if (this.locked) return;
    this.mutateAndSave(`move up ${messageId}`, (draft) => {
      const result = moveUp(draft.nodes, draft.rootId, messageId);
      return { ...draft, nodes: result.nodes, rootId: result.rootId };
    }, { requireVisibleVariantIds: [messageId] });
  }

  moveDown(messageId: number): void {
    if (this.locked) return;
    this.mutateAndSave(`move down ${messageId}`, (draft) => {
      const result = moveDown(draft.nodes, draft.rootId, messageId);
      return { ...draft, nodes: result.nodes, rootId: result.rootId };
    }, { requireVisibleVariantIds: [messageId] });
  }

  changeVariant(messageId: number, delta: number): void {
    if (this.locked) return;
    this.mutateAndSave(`change variant ${messageId}`, (draft) => ({ ...draft, nodes: changeVariant(draft.nodes, messageId, delta) }));
  }

  fork(messageId: number): void {
    if (this.locked) return;
    const msg = this.findMessage(messageId);
    if (!msg || msg.typing) return;
    this.mutateAndSave(`fork ${messageId}`, (draft) => {
      const result = applyEditBranch(draft.nodes, messageId, msg.content || '', draft.nextId);
      return { ...draft, nodes: result.nodes, nextId: result.nextId };
    });
  }

  private findMessage(messageId: number): Message | undefined {
    const loc = findNodeByMessageId(this.nodes, messageId);
    return loc?.node?.variants?.[loc.index];
  }

  // ========================================================================
  // Editing
  // ========================================================================

  startEdit(messageId: number): void {
    if (this.locked) return;
    // Only one message can be edited at a time.
    if (this.editingId !== null && this.editingId !== messageId) return;
    const msg = this.findMessage(messageId);
    if (!msg || msg.typing) return;
    this.editingId = messageId;
    this.editingText = msg.content || '';
  }

  setEditingText(raw: unknown): void {
    if (this.editingId == null) return;
    if (typeof raw === 'string') this.editingText = normalizeEditableText(raw);
  }

  private clearEditState(): void {
    this.editingId = null;
    this.editingText = '';
    this.insertedMessageId = null;
  }

  cancelEdit(): void {
    this.clearEditState();
  }

  /** Replaces the edited message in place. */
  commitEdit(): void {
    if (this.locked || this.editingId == null) return;
    const id = this.editingId;
    const text = this.editingText;
    const ok = this.mutate(`edit message ${id}`, (draft) => ({ ...draft, nodes: commitEditReplace(draft.nodes, id, text) }));
    if (!ok) return;
    this.clearEditState();
    void this.persistNow();
  }

  /** Saves the edit as a new variant, keeping the original and its continuation. */
  commitEditAsBranch(): void {
    if (this.locked || this.editingId == null) return;
    const id = this.editingId;
    const text = this.editingText;
    const ok = this.mutate(`branch from ${id}`, (draft) => {
      const result = applyEditBranch(draft.nodes, id, text, draft.nextId);
      return { ...draft, nodes: result.nodes, nextId: result.nextId };
    });
    if (!ok) return;
    this.clearEditState();
    void this.persistNow();
  }

  /** Branches the edited message and generates a new continuation from it. */
  async commitEditAndSend(): Promise<void> {
    if (this.locked || this.editingId == null) return;
    if (this.sending) {
      logGenerationEvent(this.debug, 'Blocked commitEditAndSend: generation already active');
      return;
    }

    const id = this.editingId;
    const text = this.editingText;
    const prepared = prepareBranchAndSend(this.nodes, this.rootId, id, text, this.nextId, this.nextNodeId);
    if (!prepared) {
      logGenerationEvent(this.debug, 'Failed to prepare branch and send');
      return;
    }

    if (prepared.shouldRefreshOnly && prepared.insertIndex != null) {
      this.clearEditState();
      await this.regenerateAfter(prepared.insertIndex);
      return;
    }

    const { connectionId, apiKey } = this.resolveConnection();
    if (!apiKey) {
      // Still apply the edit as a branch, but do not create a typing node.
      const ok = this.mutate(`edit+send (branch only) ${id}`, (draft) => {
        const result = applyEditBranch(draft.nodes, id, text, draft.nextId);
        return { ...draft, nodes: result.nodes, nextId: result.nextId };
      });
      if (ok) {
        this.clearEditState();
        void this.persistNow();
      }
      return;
    }

    const typingVariantId = prepared.typingVariantId;
    const ok = this.mutate(`edit+send ${id}`, (draft) => ({
      ...draft,
      nodes: prepared.nodes,
      nextId: prepared.nextId,
      nextNodeId: prepared.nextNodeId,
    }), { requireVisibleVariantIds: () => (typingVariantId != null ? [typingVariantId] : []) });
    if (!ok) return;
    this.clearEditState();

    if (typingVariantId == null) return;
    await this.startGeneration(typingVariantId, connectionId, { action: 'commitEditAndSend' });
  }

  /** Inserts an empty message after the given visible index and edits it. */
  insertBetween(afterIndex: number): void {
    if (this.locked || this.editingId !== null) return;
    const result = insertMessageBetween(this.nodes, this.rootId, afterIndex, this.nextId, this.nextNodeId);
    if (!result) return;
    const ok = this.mutate(`insert between ${afterIndex}`, (draft) => ({
      ...draft,
      nodes: result.nodes,
      nextId: result.nextId,
      nextNodeId: result.nextNodeId,
    }));
    if (!ok) return;
    this.editingId = result.insertedMessageId;
    this.editingText = '';
    this.insertedMessageId = result.insertedMessageId;
    void this.persistNow();
  }

  deleteInsertedMessage(): void {
    if (this.insertedMessageId == null) return;
    const idToDelete = this.insertedMessageId;
    this.clearEditState();
    this.mutateAndSave(`delete inserted ${idToDelete}`, (draft) => {
      const result = deleteMessage(draft.nodes, draft.rootId, idToDelete);
      return { ...draft, nodes: result.nodes, rootId: result.rootId };
    }, { allowDelete: true });
  }

  // ========================================================================
  // Composer
  // ========================================================================

  setInput(value: string): void {
    this.input = value;
  }

  /** Adds the composer content to the chat without generating a reply. */
  addToChat(role: string = 'user'): void {
    if (this.locked) return;
    const text = typeof this.input === 'string' ? this.input : '';
    const imageRefs = this.images.buildAttachedImageRefs();
    const finalRole = typeof role === 'string' && role.trim() ? role.trim() : 'user';
    const ok = this.mutateAndSave(`append ${finalRole}`, (draft) => appendNode(draft, finalRole, text, imageRefs).draft);
    if (!ok) return;
    this.input = '';
    this.images.clearAttached();
    queueMicrotask(() => this.options.scrollToBottom?.());
  }

  /**
   * Sends the composer content as `role` and, when an API key is configured,
   * generates a reply. A user send with an empty composer regenerates from
   * the end of the conversation.
   */
  async send(role: string = 'user'): Promise<void> {
    if (this.locked || this.sending) return;

    const rawInput = typeof this.input === 'string' ? this.input : '';
    const trimmedInput = rawInput.trim();
    const imageRefs = this.images.buildAttachedImageRefs();
    const hasContent = trimmedInput.length > 0 || imageRefs.length > 0;

    if (role !== 'user' && !hasContent) {
      this.input = '';
      this.images.clearAttached();
      return;
    }

    const { connectionId, apiKey } = this.resolveConnection();
    // Nothing to send + no API key to generate with => just show notice.
    if (!apiKey && role === 'user' && !hasContent) return;

    let typingVariantId: number | null = null;
    const ok = this.mutate(`send ${role}`, (draft) => {
      let next = draft;
      let parentNodeId: number | null = null;

      if (role === 'user') {
        if (hasContent) {
          const prepared = prepareUserMessage(next.nodes, next.rootId, trimmedInput, next.nextId, next.nextNodeId, imageRefs);
          if (!prepared) throw new Error('Failed to prepare user message');
          parentNodeId = prepared.newNodeId;
          next = { nodes: prepared.nodes, rootId: prepared.rootId, nextId: prepared.nextId, nextNodeId: prepared.nextNodeId };
        } else {
          parentNodeId = buildVisible(next.nodes, next.rootId).at(-1)?.nodeId ?? null;
        }
      } else {
        const finalRole = typeof role === 'string' && role.trim() ? role.trim() : 'user';
        const appended = appendNode(next, finalRole, rawInput, imageRefs);
        next = appended.draft;
        parentNodeId = appended.nodeId;
      }

      if (apiKey) {
        const prepared = prepareTypingNode(next.nodes, next.rootId, parentNodeId, next.nextId, next.nextNodeId);
        typingVariantId = prepared.typingVariantId;
        next = { nodes: prepared.nodes, rootId: prepared.rootId, nextId: prepared.nextId, nextNodeId: prepared.nextNodeId };
      }
      return next;
    }, { requireVisibleVariantIds: () => (typingVariantId != null ? [typingVariantId] : []) });
    if (!ok) return;

    this.input = '';
    this.images.clearAttached();
    queueMicrotask(() => this.options.scrollToBottom?.());

    if (!apiKey || typingVariantId == null) {
      void this.persistNow();
      return;
    }
    await this.startGeneration(typingVariantId, connectionId, { action: 'send', role });
  }

  // ========================================================================
  // Regeneration
  // ========================================================================

  /** Generates a new variant of an assistant message. */
  async regenerate(messageId: number): Promise<void> {
    if (this.locked || this.sending) return;
    const { connectionId, apiKey } = this.resolveConnection();
    if (!apiKey) return;

    const prepared = prepareRefreshAssistant(this.nodes, this.rootId, messageId, this.nextId);
    if (!prepared) {
      logGenerationEvent(this.debug, 'Failed to prepare regenerate');
      return;
    }
    const typingVariantId = prepared.typingVariantId;
    const ok = this.mutate(`refresh assistant ${messageId}`, (draft) => ({
      ...draft,
      nodes: prepared.nodes,
      nextId: prepared.nextId,
    }), { requireVisibleVariantIds: () => [typingVariantId] });
    if (!ok) return;
    await this.startGeneration(typingVariantId, connectionId, { action: 'regenerate', messageId });
  }

  /** Generates a new reply after the user message at a visible index. */
  async regenerateAfter(index: number): Promise<void> {
    if (this.locked || this.sending) return;
    const { connectionId, apiKey } = this.resolveConnection();
    if (!apiKey) return;

    const prepared = prepareRefreshAfterUser(this.nodes, this.rootId, index, this.nextId, this.nextNodeId);
    if (!prepared) {
      logGenerationEvent(this.debug, 'Failed to prepare regenerateAfter');
      return;
    }
    const typingVariantId = prepared.typingVariantId;
    const ok = this.mutate(`refresh after user ${index}`, (draft) => ({
      ...draft,
      nodes: prepared.nodes,
      nextId: prepared.nextId,
      nextNodeId: prepared.nextNodeId ?? draft.nextNodeId,
    }), { requireVisibleVariantIds: () => [typingVariantId] });
    if (!ok) return;
    await this.startGeneration(typingVariantId, connectionId, { action: 'regenerateAfter', index });
  }

  // ========================================================================
  // Generation
  // ========================================================================

  /** Stops the current generation, keeping whatever text has streamed. */
  stop(): void {
    if (!this.stopRun()) return;
    void this.persistNow();
  }

  private stopRun(): boolean {
    const run = this.lifecycle.stop();
    if (!run) return false;
    this.updateVariant(run.typingVariantId, (prev) => ({
      ...prev,
      typing: false,
      error: undefined,
      reasoningSummaryLoading: false,
      content: prev.content === 'typing' ? '' : prev.content,
    }));
    return true;
  }

  private async startGeneration(typingVariantId: number, connectionId: string | null, logContext: Record<string, unknown>): Promise<void> {
    // Extra guard: should already be guaranteed by the mutation validator.
    if (!validateTypingVariantVisible(this.nodes, this.rootId, typingVariantId)) {
      logGenerationEvent(this.debug, 'Typing node not visible', { typingVariantId, ...logContext });
      this.nodes = handleGenerationError(this.nodes, typingVariantId, new Error('Typing node not visible'));
      void this.persistNow();
      return;
    }

    const run = this.lifecycle.begin({ chatId: this.chatId, typingVariantId });
    if (!run) {
      this.nodes = handleGenerationError(this.nodes, typingVariantId, new Error('Another generation is already running'));
      void this.persistNow();
      return;
    }
    logGenerationEvent(this.debug, 'Starting generation', { sequence: run.sequence, typingVariantId, ...logContext });
    void this.persistNow();
    await this.runGeneration(run, connectionId, logContext);
  }

  /**
   * Streams a response into the run's typing variant, stores generated
   * media, applies success or error to the graph and persists. Updates from
   * a stopped or superseded run are discarded.
   */
  private async runGeneration(run: GenerationRun, connectionId: string | null, logContext: Record<string, unknown>): Promise<void> {
    const typingVariantId = run.typingVariantId;
    let summaryBuffer = '';
    try {
      const requestNodes = await this.images.prepareRequestNodes(deepClone(this.nodes), this.rootId, typingVariantId);
      if (!run.isCurrent()) return;
      // Tavern: inject prompt preset blocks around the history for character chats
      const injections = (this.characterId && this.character)
        ? buildPromptInjections(
            resolvePromptPreset(this.settings?.promptPresets, this.settings?.selectedPromptPresetId),
            this.character,
            this.settings?.persona || null
          )
        : null;
      const reply = await generateResponse({
        nodes: requestNodes,
        rootId: this.rootId,
        chatSettings: this.chatSettings,
        connectionId,
        streaming: this.chatSettings.streaming,
        historyPrefix: injections?.prefix,
        historySuffix: injections?.suffix,
        typingVariantId,
        onAbort: (fn) => run.setAbort(fn),
        onTextDelta: (full) => {
          if (run.isCurrent()) this.updateVariant(typingVariantId, (prev) => ({ ...prev, content: full }));
        },
        onReasoningSummaryDelta: (fullSummary) => {
          if (!run.isCurrent() || typeof fullSummary !== 'string') return;
          summaryBuffer = fullSummary;
          this.updateVariant(typingVariantId, (prev) => ({ ...prev, reasoningSummary: summaryBuffer, reasoningSummaryLoading: true }));
        },
        onReasoningSummaryDone: (fullSummary) => {
          if (!run.isCurrent() || typeof fullSummary !== 'string') return;
          summaryBuffer = fullSummary;
          this.updateVariant(typingVariantId, (prev) => ({ ...prev, reasoningSummary: summaryBuffer, reasoningSummaryLoading: false }));
        },
      });
      logGenerationEvent(this.debug, 'API request completed', { typingVariantId, ...logContext });

      if (run.isCurrent()) {
        const storedReply = await this.images.storeGeneratedImagesInMedia(reply);
        // Re-check after the await: Stop may have been pressed while storing images.
        if (run.isCurrent()) {
          this.nodes = handleGenerationSuccess(this.nodes, typingVariantId, storedReply, summaryBuffer);
        }
      }
    } catch (err) {
      logGenerationEvent(this.debug, 'Generation error', { error: errorMessage(err), typingVariantId, ...logContext });
      if (run.isCurrent()) this.nodes = handleGenerationError(this.nodes, typingVariantId, err);
    } finally {
      this.lifecycle.settle(run);
      if (!this.destroyed) {
        try { await this.persistNow(); } catch { /* the persister reports save errors itself */ }
      }
    }
  }

  // ========================================================================
  // Chat settings
  // ========================================================================

  updateChatSettings(patch: Partial<ChatSettings>): void {
    this.chatSettings = { ...this.chatSettings, ...patch };
    this.writeTavernPresetPatch(patch as Record<string, unknown>);
  }

  /** Changes the OpenRouter provider; always a per-chat override. */
  setOpenRouterProvider(value: string): void {
    this.chatSettings = { ...this.chatSettings, openRouterProvider: value };
  }

  selectPreset(preset: Preset | null | undefined, applyProvider: boolean = true): void {
    if (!preset || typeof preset !== 'object') return;
    this.chatSettings = applyPresetToChatSettings(this.chatSettings, preset, applyProvider);
    // Tavern: picking a preset switches the tavern-wide selection, unless
    // per-chat presets are enabled (then it only affects this chat).
    if (this.characterId && preset.id) {
      const current = this.settings;
      if (!current?.tavernPerChatPresets && resolveTavernPresetId(current) !== preset.id) {
        this.saveSettings({ ...current, tavernSelectedPresetId: preset.id });
      }
    }
    void this.persistNow();
  }

  // Tavern quick preset edit: chat settings changes in a character chat write
  // straight back to the tavern-selected preset, so the settings popover acts
  // as a quick preset editor instead of per-chat overrides.
  private writeTavernPresetPatch(patch: Record<string, unknown>): void {
    if (!this.characterId) return;
    const current = this.settings;
    if (current?.tavernPerChatPresets) return;
    const targetId = resolveTavernPresetId(current);
    if (!targetId) return;
    const list = Array.isArray(current?.presets) ? current.presets : [];
    if (!list.some(p => p?.id === targetId)) return;
    const nextPresets = list.map(p => (p?.id === targetId ? { ...p, ...patch } : p));
    this.appliedTavernPresetSig = JSON.stringify(nextPresets.find(p => p?.id === targetId));
    this.saveSettings({ ...current, presets: nextPresets });
  }

  private saveSettings(next: AppSettings): void {
    try { this.options.saveSettings?.(next); } catch { /* settings persistence reports its own errors */ }
  }

  // ========================================================================
  // Debug tools
  // ========================================================================

  async toggleDebugLock(): Promise<void> {
    if (!this.debug) return;
    await this.setDebugLock(!this.forcedLock);
  }

  private async setDebugLock(lock: boolean): Promise<void> {
    const chatId = this.chatId;
    this.forcedLock = lock;
    this.nodes = lock ? applyDebugLockToNodes(this.nodes) : clearDebugLockFromNodes(this.nodes);
    try { await this.persistNow(); } catch { /* ignore */ }
    if (chatId) {
      try { await debugSetChatLockState(chatId, lock); } catch { /* ignore */ }
    }
  }

  /** Deletes a message without the edit guard's delete allowance (debug). */
  debugMessageDeath(messageId: number): void {
    if (!this.debug || this.locked) return;
    this.mutate(`message death ${messageId}`, (draft) => {
      const result = deleteMessage(draft.nodes, draft.rootId, messageId);
      return { ...draft, nodes: result.nodes, rootId: result.rootId };
    });
  }

  // Deliberately breaks branching: duplicates a variant while keeping its
  // continuation, to exercise branch-corruption handling.
  debugDuplicateBranch(messageId: number): void {
    if (this.locked) return;
    const loc = findNodeByMessageId(this.nodes, messageId);
    const node = loc?.node;
    const cur = loc ? node?.variants?.[loc.index] : undefined;
    if (!node || !cur) return;
    const branched: Message = {
      id: this.nextId++,
      role: cur.role,
      content: cur.content,
      time: Date.now(),
      typing: false,
      error: undefined,
      next: cur.next != null ? cur.next : null,
    };
    this.nodes = this.nodes.map(n => (n.id === node.id
      ? { ...n, variants: [...(n.variants || []), branched], active: n.variants?.length || 0 }
      : n));
    void this.persistNow();
  }
}
