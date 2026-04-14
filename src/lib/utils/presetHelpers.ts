import {
  normalizeReasoning,
  normalizeVerbosity,
  normalizeReasoningSummary,
  parseMaxTokens,
  parseTopP,
  parseTemperature,
  parseThinkingBudgetTokens
} from './validation.js';
import type {
  Preset,
  PresetFields,
  Settings,
  ChatSettings,
  ReasoningEffort,
  TextVerbosity,
  ReasoningSummary
} from '../types/index.js';
import { isPlainObject, normalizeMcpServerList } from '../types/index.js';

export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';
export const DEFAULT_MODEL = 'gpt-5.4';

export const DEFAULT_PRESET_FIELDS: PresetFields = {
  model: DEFAULT_MODEL,
  streaming: true,
  maxOutputTokens: null,
  topP: null,
  temperature: null,
  reasoningEffort: 'medium',
  textVerbosity: 'medium',
  reasoningSummary: 'auto',
  thinkingEnabled: false,
  thinkingBudgetTokens: null,
  connectionId: null,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  // Web Search defaults
  webSearchEnabled: false,
  webSearchDomains: undefined,
  webSearchCountry: undefined,
  webSearchCity: undefined,
  webSearchRegion: undefined,
  webSearchTimezone: undefined,
  webSearchCacheOnly: false,
  // Code Interpreter defaults
  codeInterpreterEnabled: false,
  codeInterpreterNetworkEnabled: false,
  codeInterpreterAllowedDomains: undefined,
  // Shell defaults
  shellEnabled: false,
  shellNetworkEnabled: false,
  shellAllowedDomains: undefined,
  // Image Generation defaults
  imageGenerationEnabled: false,
  imageGenerationModel: undefined,
  // MCP defaults
  mcpEnabled: false,
  mcpServers: [],
};

export function generatePresetId(): string {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeName(name: unknown, index: number): string {
  if (typeof name === 'string' && name.trim()) return name.trim();
  return `Preset ${index + 1}`;
}

function resolveConnectionId(
  candidate: unknown,
  allowedConnectionIds: string[] = [],
  fallbackConnectionId: string | null = null
): string | null {
  const trimmed = typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
  if (!allowedConnectionIds || !allowedConnectionIds.length) {
    return trimmed ?? fallbackConnectionId ?? null;
  }
  if (trimmed && allowedConnectionIds.includes(trimmed)) {
    return trimmed;
  }
  return allowedConnectionIds.includes(fallbackConnectionId ?? '') 
    ? fallbackConnectionId 
    : (allowedConnectionIds[0] || null);
}

export interface NormalizePresetOptions {
  generateId?: boolean;
  allowedConnectionIds?: string[];
  fallbackConnectionId?: string | null;
  defaultSystemPrompt?: string;
}

export function normalizePreset(
  raw: unknown,
  index: number = 0,
  options: NormalizePresetOptions = {}
): Preset {
  const {
    generateId = false,
    allowedConnectionIds = [],
    fallbackConnectionId = null,
    defaultSystemPrompt = DEFAULT_SYSTEM_PROMPT,
  } = options;
  
  const base = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
  const idCandidate = (typeof base.id === 'string' && (base.id as string).trim()) ? (base.id as string).trim() : null;
  const id = generateId
    ? (idCandidate ?? generatePresetId())
    : (idCandidate ?? null);
  // Only include name if it was provided or if generateId is true (default behavior for list)
  const hasName = typeof base.name === 'string' && (base.name as string).trim();
  const name = hasName ? (base.name as string).trim() : (generateId ? sanitizeName(base.name, index) : undefined);
  const model = (typeof base.model === 'string' && (base.model as string).trim()) 
    ? (base.model as string).trim() 
    : DEFAULT_PRESET_FIELDS.model;
  const streaming = typeof base.streaming === 'boolean' ? base.streaming : DEFAULT_PRESET_FIELDS.streaming;
  const maxOutputTokens = parseMaxTokens(base.maxOutputTokens);
  const topP = parseTopP(base.topP);
  const temperature = parseTemperature(base.temperature);
  const reasoningEffort = normalizeReasoning(base.reasoningEffort);
  const textVerbosity = normalizeVerbosity(base.textVerbosity);
  const reasoningSummary = normalizeReasoningSummary(base.reasoningSummary);
  const thinkingEnabled = !!base.thinkingEnabled;
  const thinkingBudgetTokens = parseThinkingBudgetTokens(base.thinkingBudgetTokens);
  const connectionId = resolveConnectionId(base.connectionId, allowedConnectionIds, fallbackConnectionId);
  const systemPrompt = typeof base.systemPrompt === 'string' ? base.systemPrompt : defaultSystemPrompt;
  
  // Web Search settings
  const webSearchEnabled = typeof base.webSearchEnabled === 'boolean' ? base.webSearchEnabled : false;
  const webSearchDomains = typeof base.webSearchDomains === 'string' ? base.webSearchDomains : undefined;
  const webSearchCountry = typeof base.webSearchCountry === 'string' ? base.webSearchCountry : undefined;
  const webSearchCity = typeof base.webSearchCity === 'string' ? base.webSearchCity : undefined;
  const webSearchRegion = typeof base.webSearchRegion === 'string' ? base.webSearchRegion : undefined;
  const webSearchTimezone = typeof base.webSearchTimezone === 'string' ? base.webSearchTimezone : undefined;
  const webSearchCacheOnly = typeof base.webSearchCacheOnly === 'boolean' ? base.webSearchCacheOnly : false;

  // Code Interpreter settings
  const codeInterpreterEnabled = typeof base.codeInterpreterEnabled === 'boolean' ? base.codeInterpreterEnabled : false;
  const codeInterpreterNetworkEnabled = typeof base.codeInterpreterNetworkEnabled === 'boolean' ? base.codeInterpreterNetworkEnabled : false;
  const codeInterpreterAllowedDomains = typeof base.codeInterpreterAllowedDomains === 'string' ? base.codeInterpreterAllowedDomains : undefined;

  // Shell settings
  const shellEnabled = typeof base.shellEnabled === 'boolean' ? base.shellEnabled : false;
  const shellNetworkEnabled = typeof base.shellNetworkEnabled === 'boolean' ? base.shellNetworkEnabled : false;
  const shellAllowedDomains = typeof base.shellAllowedDomains === 'string' ? base.shellAllowedDomains : undefined;

  // Image Generation settings
  const imageGenerationEnabled = typeof base.imageGenerationEnabled === 'boolean' ? base.imageGenerationEnabled : false;
  const imageGenerationModel = typeof base.imageGenerationModel === 'string' ? base.imageGenerationModel : undefined;

  // MCP settings
  const mcpEnabled = typeof base.mcpEnabled === 'boolean' ? base.mcpEnabled : false;
  const mcpServers = normalizeMcpServerList(base.mcpServers);

  const result: Preset = {
    id,
    model,
    streaming,
    maxOutputTokens: maxOutputTokens ?? null,
    topP: topP ?? null,
    temperature: temperature ?? null,
    reasoningEffort,
    textVerbosity,
    reasoningSummary,
    thinkingEnabled,
    thinkingBudgetTokens,
    connectionId,
    systemPrompt,
    // Web Search settings
    webSearchEnabled,
    webSearchDomains,
    webSearchCountry,
    webSearchCity,
    webSearchRegion,
    webSearchTimezone,
    webSearchCacheOnly,
    // Code Interpreter settings
    codeInterpreterEnabled,
    codeInterpreterNetworkEnabled,
    codeInterpreterAllowedDomains,
    // Shell settings
    shellEnabled,
    shellNetworkEnabled,
    shellAllowedDomains,
    // Image Generation settings
    imageGenerationEnabled,
    imageGenerationModel,
    // MCP settings
    mcpEnabled,
    mcpServers,
  };

  // Only include name if it was explicitly provided or if generating for a list
  if (name !== undefined) {
    result.name = name;
  } else if (generateId) {
    result.name = sanitizeName(base.name, index);
  }

  return result;
}

export function makeDefaultPreset(connectionId: string | null = null): Preset {
  return {
    id: 'preset-default',
    name: 'Default',
    ...DEFAULT_PRESET_FIELDS,
    connectionId,
  };
}

export interface EnsurePresetListOptions {
  allowedConnectionIds?: string[];
  fallbackConnectionId?: string | null;
}

export function ensurePresetList(
  list: unknown,
  options: EnsurePresetListOptions = {}
): Preset[] {
  const { allowedConnectionIds = [], fallbackConnectionId = null } = options;
  const arr = Array.isArray(list) ? list : [];
  const normalized = arr
    .map((item, index) => normalizePreset(item, index, {
      generateId: true,
      allowedConnectionIds,
      fallbackConnectionId,
    }))
    .filter(Boolean);

  if (!normalized.length) {
    return [makeDefaultPreset(fallbackConnectionId)];
  }

  const seen = new Set<string>();
  return normalized.map((preset) => {
    let id = preset.id;
    while (seen.has(id)) {
      id = generatePresetId();
    }
    seen.add(id);
    return { ...preset, id };
  });
}

export interface DeriveDefaultPresetOptions {
  fallbackConnectionId?: string | null;
  allowedConnectionIds?: string[];
}

export function deriveDefaultPreset(
  parsed: Record<string, unknown> | null,
  options: DeriveDefaultPresetOptions = {}
): Preset {
  const fallbackConnectionId = options?.fallbackConnectionId || null;
  const allowedConnectionIds = Array.isArray(options?.allowedConnectionIds) ? options.allowedConnectionIds : [];
  
  const defaultChat = (parsed?.defaultChat && typeof parsed.defaultChat === 'object') 
    ? parsed.defaultChat as Record<string, unknown> 
    : {};
    
  const candidate = {
    id: 'preset-default',
    name: 'Default',
    model: (defaultChat?.model as string) || (parsed?.model as string) || DEFAULT_PRESET_FIELDS.model,
    streaming: typeof defaultChat?.streaming === 'boolean'
      ? defaultChat.streaming
      : DEFAULT_PRESET_FIELDS.streaming,
    maxOutputTokens: (defaultChat?.maxOutputTokens as number | null) ?? null,
    topP: (defaultChat?.topP as number | null) ?? null,
    temperature: (defaultChat?.temperature as number | null) ?? null,
    reasoningEffort: (defaultChat?.reasoningEffort as string) || DEFAULT_PRESET_FIELDS.reasoningEffort,
    textVerbosity: (defaultChat?.textVerbosity as string) || DEFAULT_PRESET_FIELDS.textVerbosity,
    reasoningSummary: (defaultChat?.reasoningSummary as string) || DEFAULT_PRESET_FIELDS.reasoningSummary,
    thinkingEnabled: !!defaultChat?.thinkingEnabled,
    thinkingBudgetTokens: (defaultChat?.thinkingBudgetTokens as number | null) ?? null,
    connectionId: (defaultChat?.connectionId as string)
      || (parsed?.connectionId as string)
      || fallbackConnectionId,
    systemPrompt: typeof defaultChat?.systemPrompt === 'string'
      ? defaultChat.systemPrompt
      : DEFAULT_SYSTEM_PROMPT,
  };
  
  return normalizePreset(candidate, 0, {
    generateId: true,
    allowedConnectionIds,
    fallbackConnectionId,
  });
}

export interface ResolvePresetPreferences {
  presetId?: string;
  preset?: Preset | Record<string, unknown>;
}

export function resolvePreset(
  settings: Partial<Settings> | null,
  preferences: ResolvePresetPreferences = {}
): Preset {
  const list = Array.isArray(settings?.presets) ? settings.presets : [];
  const byId = new Map(list.map((preset) => [preset?.id, preset]));

  const allowedConnectionIds = Array.isArray(settings?.connections)
    ? settings.connections.map((c) => c?.id).filter((id): id is string => typeof id === 'string')
    : [];
  const fallbackConnectionId = typeof settings?.selectedConnectionId === 'string'
    ? settings.selectedConnectionId
    : null;

  const pickById = (id: unknown): Preset | undefined => 
    (typeof id === 'string' ? byId.get(id) : undefined);

  let chosen = pickById(preferences?.presetId);
  if (!chosen && preferences?.preset && typeof preferences.preset === 'object') {
    const presetObj = preferences.preset as Record<string, unknown>;
    chosen = pickById(presetObj.id) || (preferences.preset as Preset);
  }
  if (!chosen) {
    chosen = pickById(settings?.selectedPresetId);
  }
  if (!chosen) {
    chosen = list[0];
  }

  if (!chosen) {
    return makeDefaultPreset(fallbackConnectionId);
  }

  return normalizePreset(chosen, 0, {
    allowedConnectionIds,
    fallbackConnectionId,
  });
}

export interface ComputeConnectionIdOptions {
  preset?: Partial<Preset> | null;
  settings?: Partial<Settings> | null;
  fallbackConnectionId?: string | null;
}

export function computeConnectionId(options: ComputeConnectionIdOptions = {}): string | null {
  const { preset, settings, fallbackConnectionId = null } = options;
  const presetConn = typeof preset?.connectionId === 'string' && preset.connectionId.trim()
    ? preset.connectionId.trim()
    : null;
  if (presetConn) return presetConn;
  const settingsConn = typeof settings?.selectedConnectionId === 'string' && settings.selectedConnectionId.trim()
    ? settings.selectedConnectionId.trim()
    : null;
  if (settingsConn) return settingsConn;
  return fallbackConnectionId;
}

export function buildChatSettings(preset: Preset, settings: Partial<Settings> | null): ChatSettings {
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
    thinkingEnabled: !!preset.thinkingEnabled,
    thinkingBudgetTokens: parseThinkingBudgetTokens(preset.thinkingBudgetTokens),
    connectionId: computeConnectionId({ preset, settings }),
    // Web Search settings
    webSearchEnabled: !!preset.webSearchEnabled,
    webSearchDomains: preset.webSearchDomains,
    webSearchCountry: preset.webSearchCountry,
    webSearchCity: preset.webSearchCity,
    webSearchRegion: preset.webSearchRegion,
    webSearchTimezone: preset.webSearchTimezone,
    webSearchCacheOnly: !!preset.webSearchCacheOnly,
    // Code Interpreter settings
    codeInterpreterEnabled: !!preset.codeInterpreterEnabled,
    codeInterpreterNetworkEnabled: !!preset.codeInterpreterNetworkEnabled,
    codeInterpreterAllowedDomains: preset.codeInterpreterAllowedDomains,
    // Shell settings
    shellEnabled: !!preset.shellEnabled,
    shellNetworkEnabled: !!preset.shellNetworkEnabled,
    shellAllowedDomains: preset.shellAllowedDomains,
    // Image Generation settings
    imageGenerationEnabled: !!preset.imageGenerationEnabled,
    imageGenerationModel: preset.imageGenerationModel,
    // MCP settings
    mcpEnabled: !!preset.mcpEnabled,
    mcpServers: normalizeMcpServerList(preset.mcpServers),
  };
}

/**
 * Merges loaded chat settings with preset defaults.
 * This is the single source of truth for loading ChatSettings - when adding new fields
 * to ChatSettings, add them here to ensure they are properly loaded from storage.
 */
export function loadChatSettings(
  loaded: { settings?: Partial<ChatSettings>; presetId?: string | null } | null,
  preset: Preset,
  settings: Partial<Settings> | null
): ChatSettings {
  const s = loaded?.settings || {};
  const has = <K extends keyof ChatSettings>(key: K): boolean => isPlainObject(s) && key in s;

  return {
    model: s.model || preset.model || DEFAULT_MODEL,
    streaming: typeof s.streaming === 'boolean' ? s.streaming : preset.streaming,
    presetId: (typeof loaded?.presetId === 'string') ? loaded.presetId : preset.id,
    maxOutputTokens: parseMaxTokens(has('maxOutputTokens') ? s.maxOutputTokens : preset.maxOutputTokens),
    topP: parseTopP(has('topP') ? s.topP : preset.topP),
    temperature: parseTemperature(has('temperature') ? s.temperature : preset.temperature),
    reasoningEffort: normalizeReasoning(has('reasoningEffort') ? s.reasoningEffort : preset.reasoningEffort),
    textVerbosity: normalizeVerbosity(has('textVerbosity') ? s.textVerbosity : preset.textVerbosity),
    reasoningSummary: normalizeReasoningSummary(has('reasoningSummary') ? s.reasoningSummary : preset.reasoningSummary),
    thinkingEnabled: has('thinkingEnabled') ? !!s.thinkingEnabled : !!preset.thinkingEnabled,
    thinkingBudgetTokens: parseThinkingBudgetTokens(has('thinkingBudgetTokens') ? s.thinkingBudgetTokens : preset.thinkingBudgetTokens),
    connectionId: (() => {
      const candidatePreset = {
        ...preset,
        connectionId: (() => {
          const fromLoaded = has('connectionId') ? s.connectionId : undefined;
          if (typeof fromLoaded === 'string' && fromLoaded.trim()) return fromLoaded.trim();
          return preset?.connectionId || null;
        })(),
      };
      return computeConnectionId({ preset: candidatePreset, settings });
    })(),
    // Web Search settings
    webSearchEnabled: has('webSearchEnabled') ? !!s.webSearchEnabled : !!preset.webSearchEnabled,
    webSearchDomains: has('webSearchDomains') ? s.webSearchDomains : preset.webSearchDomains,
    webSearchCountry: has('webSearchCountry') ? s.webSearchCountry : preset.webSearchCountry,
    webSearchCity: has('webSearchCity') ? s.webSearchCity : preset.webSearchCity,
    webSearchRegion: has('webSearchRegion') ? s.webSearchRegion : preset.webSearchRegion,
    webSearchTimezone: has('webSearchTimezone') ? s.webSearchTimezone : preset.webSearchTimezone,
    webSearchCacheOnly: has('webSearchCacheOnly') ? !!s.webSearchCacheOnly : !!preset.webSearchCacheOnly,
    // Code Interpreter settings
    codeInterpreterEnabled: has('codeInterpreterEnabled') ? !!s.codeInterpreterEnabled : !!preset.codeInterpreterEnabled,
    codeInterpreterNetworkEnabled: has('codeInterpreterNetworkEnabled') ? !!s.codeInterpreterNetworkEnabled : !!preset.codeInterpreterNetworkEnabled,
    codeInterpreterAllowedDomains: has('codeInterpreterAllowedDomains') ? s.codeInterpreterAllowedDomains : preset.codeInterpreterAllowedDomains,
    // Shell settings
    shellEnabled: has('shellEnabled') ? !!s.shellEnabled : !!preset.shellEnabled,
    shellNetworkEnabled: has('shellNetworkEnabled') ? !!s.shellNetworkEnabled : !!preset.shellNetworkEnabled,
    shellAllowedDomains: has('shellAllowedDomains') ? s.shellAllowedDomains : preset.shellAllowedDomains,
    // Image Generation settings
    imageGenerationEnabled: has('imageGenerationEnabled') ? !!s.imageGenerationEnabled : !!preset.imageGenerationEnabled,
    imageGenerationModel: has('imageGenerationModel') ? s.imageGenerationModel : preset.imageGenerationModel,
    // MCP settings
    mcpEnabled: has('mcpEnabled') ? !!s.mcpEnabled : !!preset.mcpEnabled,
    mcpServers: normalizeMcpServerList(has('mcpServers') ? s.mcpServers : preset.mcpServers),
  };
}
