// Shared draft state and mutations for the settings modal tabs.
// Owns the editable copy of settings ("local"), the active connection/preset
// selection, model caches and the debounced persist pipeline.

import { loadSettings, saveSettings } from '../../settingsStore.js';
import { setModelsCache, loadAllModelCaches } from '../../modelsStore.js';
import { listModelsWithKey } from '../../openaiClient.js';
import { DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT } from '../../utils/presetHelpers.js';
import { DEFAULT_MESSAGE_ACTIONS, DEFAULT_EDITOR_ACTIONS, DEFAULT_TOOL_SETTINGS } from '../../constants/defaults.js';
import type {
  AppSettings,
  Preset,
  Connection,
  MessageActionButton,
  MessageActionRole,
  EditorActionButton,
  DefaultToolSettings,
} from '../../types/index.js';

export const REASONING_OPTIONS = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
export const TEXT_VERBOSITY_OPTIONS = ['none', 'low', 'medium', 'high'];
export const REASONING_SUMMARY_OPTIONS = ['none', 'auto', 'concise', 'detailed'];
export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';

// --- Input parsing helpers (used by the presets tab) -------------------------

export function parseMaxTokens(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.max(1, Math.floor(num));
  return Number.isFinite(rounded) ? rounded : null;
}

export function parseTopP(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(1, Math.max(0, num));
}

export function parseTemperature(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(2, Math.max(0, num));
}

export function parseReasoning(value: unknown): string {
  return REASONING_OPTIONS.includes(value as string) ? value as string : 'default';
}

export function parseVerbosity(value: unknown): string {
  return TEXT_VERBOSITY_OPTIONS.includes(value as string) ? value as string : 'medium';
}

export function parseReasoningSummary(value: unknown): string {
  return REASONING_SUMMARY_OPTIONS.includes(value as string) ? value as string : 'auto';
}

export function parseThinkingBudget(value: unknown): number | null {
  return parseMaxTokens(value);
}

function genPresetId(): string {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function genConnectionId(): string {
  return `connection_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function cloneMessageActions(actions?: MessageActionButton[]): MessageActionButton[] {
  const source = Array.isArray(actions) ? actions : DEFAULT_MESSAGE_ACTIONS;
  return source.map(a => ({ ...a, roles: a.roles ? { ...a.roles } : undefined }));
}

export class SettingsDraft {
  local = $state<AppSettings>(loadSettings());
  activePresetId = $state('');
  activeConnectionId = $state('');
  modelCacheByConnection = $state<Record<string, { ids: string[]; fetchedAt: number }>>({});
  modelCacheLoaded = $state(false);
  refreshMessages = $state<Record<string, string>>({});
  refreshingConnectionId = $state('');

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private onSaved: (() => void) | undefined;

  constructor(onSaved?: () => void) {
    this.onSaved = onSaved;
  }

  // --- Getters ---------------------------------------------------------------

  get connections(): Connection[] {
    return Array.isArray(this.local?.connections) ? this.local.connections : [];
  }

  get presets(): Preset[] {
    return Array.isArray(this.local?.presets) ? this.local.presets : [];
  }

  get activePreset(): Preset | null {
    const list = this.presets;
    const found = list.find(p => p?.id === this.activePresetId);
    return found || list[0] || null;
  }

  get activeConnection(): Connection | null {
    const list = this.connections;
    const found = list.find(c => c?.id === this.activeConnectionId);
    const fallback = list.find(c => c?.id === this.local?.selectedConnectionId);
    return found || fallback || list[0] || null;
  }

  get activeConnectionModels(): string[] {
    const entry = this.modelCacheByConnection?.[this.activeConnectionId];
    return Array.isArray(entry?.ids) ? entry.ids : [];
  }

  get activeRefreshMsg(): string {
    return (this.refreshMessages?.[this.activeConnectionId]) || '';
  }

  get activeConnectionRefreshing(): boolean {
    return this.refreshingConnectionId === this.activeConnectionId;
  }

  get activePresetModels(): string[] {
    const connectionId = this.activePreset?.connectionId;
    if (!connectionId) return [];
    const entry = this.modelCacheByConnection?.[connectionId];
    return Array.isArray(entry?.ids) ? entry.ids : [];
  }

  /** Whether the active preset's connection supports Responses API features. */
  get activePresetSupportsResponsesApiFeatures(): boolean {
    const connectionId = this.activePreset?.connectionId;
    if (!connectionId) return false;
    const connection = this.connections.find(c => c.id === connectionId);
    return connection?.apiMode === 'responses';
  }

  get messageActions(): MessageActionButton[] {
    return cloneMessageActions(this.local?.messageActions);
  }

  get editorActions(): EditorActionButton[] {
    return Array.isArray(this.local?.editorActions) ? this.local.editorActions : DEFAULT_EDITOR_ACTIONS.map(a => ({ ...a }));
  }

  get defaultTools(): DefaultToolSettings {
    return this.local?.defaultTools ?? { ...DEFAULT_TOOL_SETTINGS };
  }

  // --- Persistence -----------------------------------------------------------

  persist(): void {
    // Debounce to avoid blocking on rapid state changes
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.syncActiveConnection();
      this.syncActivePreset();
      saveSettings(this.local);
      try { this.onSaved?.(); } catch { /* ignore */ }
    }, 0);
  }

  syncActiveConnection(): void {
    let list = this.connections;
    if (!list.length) {
      const conn: Connection = {
        id: genConnectionId(),
        name: 'Connection 1',
        apiKey: '',
        apiBaseUrl: DEFAULT_API_BASE_URL,
        apiMode: 'responses',
      };
      this.local.connections = [conn];
      list = this.local.connections;
    }
    const hasActive = list.some(c => c?.id === this.activeConnectionId);
    const fallback = list.find(c => c?.id === this.local?.selectedConnectionId)
      || list[0]
      || null;
    const nextId = hasActive ? this.activeConnectionId : (fallback?.id || '');
    if (nextId !== this.activeConnectionId) this.activeConnectionId = nextId;
    if (nextId && this.local.selectedConnectionId !== nextId) {
      this.local.selectedConnectionId = nextId;
    }
    const active = list.find(c => c?.id === nextId) || fallback || null;
    const mode = typeof active?.apiMode === 'string' && active.apiMode ? active.apiMode : 'responses';
    this.local.apiMode = mode;
  }

  syncActivePreset(): void {
    const list = this.presets;
    if (!list.length) {
      this.local.presets = [{
        id: genPresetId(),
        name: 'Preset 1',
        model: DEFAULT_MODEL,
        streaming: true,
        maxOutputTokens: null,
        topP: null,
        temperature: null,
        reasoningEffort: 'default',
        textVerbosity: 'medium',
        reasoningSummary: 'auto',
        connectionId: this.local?.selectedConnectionId || this.activeConnectionId || (this.local?.connections?.[0]?.id || ''),
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
      } as Preset];
    }
    const updatedList = this.presets;
    const hasActive = updatedList.some(p => p?.id === this.activePresetId);
    const fallback = updatedList.find(p => p?.id === this.local?.selectedPresetId)
      || updatedList[0]
      || null;
    const nextId = hasActive ? this.activePresetId : (fallback?.id || '');
    if (nextId !== this.activePresetId) this.activePresetId = nextId;
    if (nextId && this.local.selectedPresetId !== nextId) {
      this.local.selectedPresetId = nextId;
    }
  }

  loadModelCaches(): void {
    this.modelCacheByConnection = loadAllModelCaches();
    this.modelCacheLoaded = true;
  }

  /** Resets the draft to persisted settings (when the modal closes). */
  reset(): void {
    this.local = loadSettings();
    this.modelCacheByConnection = {};
    this.modelCacheLoaded = false;
    this.activePresetId = this.local?.selectedPresetId || this.local?.presets?.[0]?.id || '';
    this.activeConnectionId = this.local?.selectedConnectionId || this.local?.connections?.[0]?.id || '';
    this.refreshingConnectionId = '';
    this.refreshMessages = {};
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }

  // --- Presets ---------------------------------------------------------------

  selectPreset(id: string): void {
    if (!id) return;
    this.activePresetId = id;
    this.local.selectedPresetId = id;
    this.persist();
  }

  addPreset(): void {
    const list = this.presets.slice();
    const base = this.activePreset || list[list.length - 1] || { model: DEFAULT_MODEL, streaming: true } as Preset;
    const count = list.length + 1;
    let name = `Preset ${count}`;
    const names = new Set(list.map(p => p?.name).filter(Boolean));
    while (names.has(name)) {
      name = `Preset ${Math.floor(Math.random() * 90) + 10}`;
    }
    const preset: Preset = {
      id: genPresetId(),
      name,
      model: base?.model || DEFAULT_MODEL,
      streaming: typeof base?.streaming === 'boolean' ? base.streaming : true,
      maxOutputTokens: base?.maxOutputTokens ?? null,
      topP: base?.topP ?? null,
      temperature: base?.temperature ?? null,
      reasoningEffort: base?.reasoningEffort || 'default',
      textVerbosity: base?.textVerbosity || 'medium',
      reasoningSummary: base?.reasoningSummary || 'auto',
      thinkingEnabled: !!base?.thinkingEnabled,
      thinkingBudgetTokens: base?.thinkingBudgetTokens ?? null,
      connectionId: base?.connectionId || this.local?.selectedConnectionId || this.activeConnectionId || (this.local?.connections?.[0]?.id || ''),
      webSearchEnabled: !!base?.webSearchEnabled,
      webSearchDomains: base?.webSearchDomains,
      webSearchCountry: base?.webSearchCountry,
      webSearchCity: base?.webSearchCity,
      webSearchRegion: base?.webSearchRegion,
      webSearchTimezone: base?.webSearchTimezone,
      webSearchCacheOnly: !!base?.webSearchCacheOnly,
      codeInterpreterEnabled: !!base?.codeInterpreterEnabled,
      codeInterpreterNetworkEnabled: !!base?.codeInterpreterNetworkEnabled,
      codeInterpreterAllowedDomains: base?.codeInterpreterAllowedDomains,
      shellEnabled: !!base?.shellEnabled,
      shellNetworkEnabled: !!base?.shellNetworkEnabled,
      shellAllowedDomains: base?.shellAllowedDomains,
      imageGenerationEnabled: !!base?.imageGenerationEnabled,
      imageGenerationModel: base?.imageGenerationModel,
      mcpEnabled: !!base?.mcpEnabled,
      mcpServers: Array.isArray(base?.mcpServers) ? base.mcpServers.map(server => ({ label: server?.label || '', url: server?.url || '' })) : [],
      systemPrompt: typeof base?.systemPrompt === 'string' ? base.systemPrompt : DEFAULT_SYSTEM_PROMPT,
    };
    this.local.presets = [...list, preset];
    this.activePresetId = preset.id!;
    this.local.selectedPresetId = preset.id!;
    this.persist();
  }

  updateActivePreset(patch: Partial<Preset>): void {
    const list = this.presets;
    const idx = list.findIndex(p => p?.id === this.activePresetId);
    if (idx < 0) return;
    const next = [...list];
    const updatedPatch: Partial<Preset> = { ...patch };

    // If connectionId is being changed, check if we need to clear responses-API-only features
    if ('connectionId' in patch) {
      const newConnection = this.connections.find(c => c.id === patch.connectionId);
      if (newConnection?.apiMode !== 'responses') {
        // Clear responses API features when switching to non-responses API connection
        updatedPatch.webSearchEnabled = false;
        updatedPatch.codeInterpreterEnabled = false;
        updatedPatch.shellEnabled = false;
        updatedPatch.imageGenerationEnabled = false;
        updatedPatch.mcpEnabled = false;
      }
    }

    next[idx] = { ...next[idx], ...updatedPatch } as Preset;
    this.local.presets = next;
    this.persist();
  }

  removePreset(id: string): void {
    const list = this.presets;
    if (list.length <= 1) return;
    const next = list.filter(p => p?.id !== id);
    if (!next.length) return;
    this.local.presets = next;
    const fallback = next.find(p => p?.id === this.local.selectedPresetId) || next[0];
    this.activePresetId = fallback?.id || '';
    this.local.selectedPresetId = fallback?.id || '';
    this.persist();
  }

  reorderPresets(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const list = this.presets.slice();
    const fromIndex = list.findIndex(p => p.id === fromId);
    const toIndex = list.findIndex(p => p.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved!);
    this.local.presets = list;
    this.persist();
  }

  // --- Connections -----------------------------------------------------------

  selectConnection(id: string): void {
    if (!id) return;
    this.activeConnectionId = id;
    this.local.selectedConnectionId = id;
    const found = this.connections.find(c => c?.id === id);
    const nextMode = typeof found?.apiMode === 'string' && found.apiMode ? found.apiMode : 'responses';
    this.local.apiMode = nextMode;
    this.persist();
  }

  addConnection(): void {
    const list = this.connections.slice();
    const base = this.activeConnection || list[list.length - 1] || null;
    const count = list.length + 1;
    let name = `Connection ${count}`;
    const names = new Set(list.map(c => c?.name).filter(Boolean));
    while (names.has(name)) {
      name = `Connection ${Math.floor(Math.random() * 90) + 10}`;
    }
    const id = genConnectionId();
    const connection: Connection = {
      id,
      name,
      apiKey: '',
      apiBaseUrl: base?.apiBaseUrl || DEFAULT_API_BASE_URL,
      apiMode: base?.apiMode || 'responses',
    };
    this.local.connections = [...list, connection];
    this.modelCacheByConnection = { ...this.modelCacheByConnection, [id]: { ids: [], fetchedAt: 0 } };
    this.activeConnectionId = id;
    this.persist();
  }

  updateActiveConnection(patch: Partial<Connection>): void {
    const list = this.connections;
    const idx = list.findIndex(c => c?.id === this.activeConnectionId);
    if (idx < 0) return;
    const next = [...list];
    const current = next[idx] || {} as Connection;
    const updated = { ...current, ...patch };
    next[idx] = updated;
    this.local.connections = next;
    // If apiMode is being changed away from 'responses', clear responses-API-only features
    // on all presets that use this connection
    if ('apiMode' in patch && patch.apiMode !== 'responses') {
      if (Array.isArray(this.local?.presets)) {
        this.local.presets = this.local.presets.map(p => {
          if (p?.connectionId === current.id) {
            return {
              ...p,
              webSearchEnabled: false,
              codeInterpreterEnabled: false,
              shellEnabled: false,
              imageGenerationEnabled: false,
              mcpEnabled: false,
            };
          }
          return p;
        });
      }
    }
    this.persist();
  }

  /**
   * Invalidate the model cache once an apiKey/apiBaseUrl edit settles
   * (change/blur), instead of destroying it on every keystroke.
   */
  invalidateActiveConnectionModelCache(): void {
    const current = this.connections.find(c => c?.id === this.activeConnectionId);
    if (!current?.id) return;
    setModelsCache(current.id, []);
    this.modelCacheByConnection = { ...this.modelCacheByConnection, [current.id]: { ids: [], fetchedAt: 0 } };
  }

  removeConnection(id: string): void {
    const list = this.connections;
    if (list.length <= 1) return;
    const next = list.filter(c => c?.id !== id);
    if (!next.length) return;
    this.local.connections = next;
    if (this.local.selectedConnectionId === id) {
      this.local.selectedConnectionId = next[0]?.id || '';
    }
    if (this.activeConnectionId === id) {
      this.activeConnectionId = next.find(c => c?.id === this.local.selectedConnectionId)?.id || next[0]?.id || '';
    }
    const fallbackId = this.local.selectedConnectionId || this.activeConnectionId || next[0]?.id || '';
    if (Array.isArray(this.local?.presets)) {
      this.local.presets = this.local.presets.map(p => (p?.connectionId === id ? { ...p, connectionId: fallbackId } : p));
    }
    const cache = { ...this.modelCacheByConnection };
    delete cache[id];
    this.modelCacheByConnection = cache;
    const msgs = { ...this.refreshMessages };
    delete msgs[id];
    this.refreshMessages = msgs;
    if (this.refreshingConnectionId === id) this.refreshingConnectionId = '';
    this.persist();
  }

  reorderConnections(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const list = this.connections.slice();
    const fromIndex = list.findIndex(c => c.id === fromId);
    const toIndex = list.findIndex(c => c.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved!);
    this.local.connections = list;
    this.persist();
  }

  async refreshModelsNow(targetId: string = this.activeConnectionId, { quiet = false }: { quiet?: boolean } = {}): Promise<void> {
    const connection = this.connections.find(c => c?.id === targetId);
    if (!connection) {
      if (!quiet) {
        this.refreshMessages = { ...this.refreshMessages, [targetId]: 'Select or add a connection first.' };
      }
      return;
    }
    if (!connection.apiKey) {
      if (!quiet) {
        this.refreshMessages = { ...this.refreshMessages, [targetId]: 'Enter an API key first.' };
      }
      return;
    }
    this.refreshingConnectionId = targetId;
    if (!quiet) {
      this.refreshMessages = { ...this.refreshMessages, [targetId]: 'Connecting…' };
    }
    try {
      const ids = await listModelsWithKey(connection.apiKey, connection.apiBaseUrl, connection.apiMode);
      setModelsCache(targetId, ids);
      this.modelCacheByConnection = { ...this.modelCacheByConnection, [targetId]: { ids, fetchedAt: Date.now() } };
      this.refreshMessages = { ...this.refreshMessages, [targetId]: `Connected ✓ Fetched ${ids.length} models.` };
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to refresh models.';
      this.refreshMessages = { ...this.refreshMessages, [targetId]: `Error: ${msg}` };
    } finally {
      if (this.refreshingConnectionId === targetId) this.refreshingConnectionId = '';
    }
  }

  // --- Message actions / editor actions / default tools -----------------------

  toggleMessageAction(id: string): void {
    const actions = cloneMessageActions(this.local?.messageActions);
    const idx = actions.findIndex(a => a.id === id);
    if (idx < 0) return;
    actions[idx]!.enabled = !actions[idx]!.enabled;
    this.local.messageActions = actions;
    this.persist();
  }

  toggleMessageActionRole(id: string, role: MessageActionRole): void {
    const actions = cloneMessageActions(this.local?.messageActions);
    const idx = actions.findIndex(a => a.id === id);
    if (idx < 0) return;
    const defaults = DEFAULT_MESSAGE_ACTIONS.find(a => a.id === id)?.roles || { user: true, assistant: true, system: true };
    actions[idx]!.roles = { ...defaults, ...actions[idx]!.roles, [role]: !(actions[idx]!.roles?.[role] ?? defaults[role]) };
    this.local.messageActions = actions;
    this.persist();
  }

  reorderMessageActions(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const actions = cloneMessageActions(this.local?.messageActions);
    const fromIndex = actions.findIndex(a => a.id === fromId);
    const toIndex = actions.findIndex(a => a.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = actions.splice(fromIndex, 1);
    actions.splice(toIndex, 0, moved!);
    this.local.messageActions = actions;
    this.persist();
  }

  resetMessageActions(): void {
    this.local.messageActions = cloneMessageActions(DEFAULT_MESSAGE_ACTIONS);
    this.persist();
  }

  toggleEditorAction(id: string): void {
    const actions = Array.isArray(this.local?.editorActions)
      ? this.local.editorActions.map(a => ({ ...a }))
      : DEFAULT_EDITOR_ACTIONS.map(a => ({ ...a }));
    const idx = actions.findIndex(a => a.id === id);
    if (idx < 0) return;
    actions[idx]!.enabled = !actions[idx]!.enabled;
    this.local.editorActions = actions;
    this.persist();
  }

  resetEditorActions(): void {
    this.local.editorActions = DEFAULT_EDITOR_ACTIONS.map(a => ({ ...a }));
    this.persist();
  }

  updateDefaultTool(key: keyof DefaultToolSettings, value: boolean): void {
    const tools = this.local?.defaultTools ? { ...this.local.defaultTools } : { ...DEFAULT_TOOL_SETTINGS };
    tools[key] = value;
    this.local.defaultTools = tools;
    this.persist();
  }
}
