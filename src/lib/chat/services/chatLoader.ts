// Chat loading and initialization
import { getChat as loadChatById, getCachedChat } from '../../chatsStore.js';
import { loadSettings } from '../../settingsStore.js';
import {
  makeSystemPrologue,
  pickPresetFromSettings,
  buildChatSettings,
  recomputeNextIds,
  ensureUniqueIds,
  detectIdCollisions,
  computeInitialConnectionId,
  DEFAULT_SYSTEM_PROMPT
} from './chatInit.js';
import { migrateLegacyGraphToNodes } from './legacyMigration.js';
import { computePersistSig } from './chatPersistence.js';
import {
  parseMaxTokens,
  parseTopP,
  parseTemperature,
  normalizeReasoning,
  normalizeVerbosity,
  normalizeReasoningSummary,
  parseThinkingBudgetTokens
} from '../../utils/validation.js';
import type { ChatNode, ChatSettings, Settings, LoadedChat, Chat, Preset } from '../../types/index.js';
import { hasOwn } from '../../types/index.js';

export async function loadChat(chatId: string | null): Promise<LoadedChat> {
  const nextSettings = loadSettings();
  const basePreset = pickPresetFromSettings(nextSettings);
  const presetsList = Array.isArray(nextSettings?.presets) ? nextSettings.presets : [];
  const fallbackPrompt = typeof basePreset?.systemPrompt === 'string' ? basePreset.systemPrompt : DEFAULT_SYSTEM_PROMPT;
  const resolveSystemPrompt = (presetId: string | null | undefined): string => {
    if (typeof presetId === 'string') {
      const match = presetsList.find(p => p?.id === presetId);
      if (match && typeof match.systemPrompt === 'string') return match.systemPrompt;
    }
    return fallbackPrompt;
  };

  let nextNodes: ChatNode[] = [];
  let nextRootId: number | null = 1;
  let nextChatSettings: ChatSettings = buildChatSettings(basePreset, nextSettings);
  let nextNextId = 1;
  let nextNextNodeId = 1;
  let nextPersistSig = '';

  if (!chatId) {
    return {
      nodes: nextNodes,
      rootId: nextRootId,
      chatSettings: nextChatSettings,
      nextId: nextNextId,
      nextNodeId: nextNextNodeId,
      persistSig: nextPersistSig,
      settings: nextSettings
    };
  }

  try {
    // Check in-memory cache first for instant loading of new chats
    const cached = getCachedChat(chatId);
    const loaded = cached || await loadChatById(chatId);

    if (loaded) {
      if (Array.isArray(loaded.nodes)) {
        nextNodes = loaded.nodes.slice();
        nextRootId = loaded?.rootId ?? (nextNodes[0]?.id || 1);
      } else {
        // Legacy support: migrate flat/graph messages to node-based
        const loadedRecord = loaded as unknown as { messages?: unknown[]; rootId?: number; selected?: Record<number, number> };
        const msgs = Array.isArray(loadedRecord.messages) ? loadedRecord.messages.slice() : [];
        const mig = migrateLegacyGraphToNodes(
          msgs as { id: number; role: string; content: string; time?: number; typing?: boolean; error?: string; next?: number[] }[],
          loadedRecord?.rootId,
          loadedRecord?.selected
        );
        nextNodes = mig.nodes;
        nextRootId = mig.rootId;
      }

      nextChatSettings = {
        model: loaded?.settings?.model || basePreset.model || 'gpt-5',
        streaming: (typeof loaded?.settings?.streaming === 'boolean'
          ? loaded.settings.streaming
          : (typeof basePreset.streaming === 'boolean' ? basePreset.streaming : true)),
        presetId: (typeof loaded?.presetId === 'string') ? loaded.presetId : basePreset.id,
        maxOutputTokens: parseMaxTokens(hasOwn(loaded?.settings || {}, 'maxOutputTokens') ? loaded.settings?.maxOutputTokens : basePreset.maxOutputTokens),
        topP: parseTopP(hasOwn(loaded?.settings || {}, 'topP') ? loaded.settings?.topP : basePreset.topP),
        temperature: parseTemperature(hasOwn(loaded?.settings || {}, 'temperature') ? loaded.settings?.temperature : basePreset.temperature),
        reasoningEffort: normalizeReasoning(hasOwn(loaded?.settings || {}, 'reasoningEffort') ? loaded.settings?.reasoningEffort : basePreset.reasoningEffort),
        textVerbosity: normalizeVerbosity(hasOwn(loaded?.settings || {}, 'textVerbosity') ? loaded.settings?.textVerbosity : basePreset.textVerbosity),
        reasoningSummary: normalizeReasoningSummary(hasOwn(loaded?.settings || {}, 'reasoningSummary') ? loaded.settings?.reasoningSummary : basePreset.reasoningSummary),
        thinkingEnabled: (() => {
          if (hasOwn(loaded?.settings || {}, 'thinkingEnabled')) return !!loaded.settings?.thinkingEnabled;
          return !!basePreset.thinkingEnabled;
        })(),
        thinkingBudgetTokens: parseThinkingBudgetTokens(hasOwn(loaded?.settings || {}, 'thinkingBudgetTokens') ? loaded.settings?.thinkingBudgetTokens : basePreset.thinkingBudgetTokens),
        connectionId: (() => {
          const candidatePreset = {
            ...basePreset,
            connectionId: (() => {
              const fromLoaded = hasOwn(loaded?.settings || {}, 'connectionId') ? loaded.settings?.connectionId : undefined;
              if (typeof fromLoaded === 'string' && fromLoaded.trim()) return fromLoaded.trim();
              return basePreset?.connectionId || null;
            })(),
          };
          return computeInitialConnectionId(candidatePreset, nextSettings);
        })(),
      };

      if (!nextNodes.length) {
        if (loaded?.rootId == null) {
          nextRootId = null;
          nextNextId = 1;
          nextNextNodeId = 1;
        } else {
          nextNextId = 2;
          nextNextNodeId = 2;
          const prompt = resolveSystemPrompt(loaded?.presetId || nextChatSettings?.presetId);
          nextNodes = [{ id: 1, variants: [{ ...makeSystemPrologue(1, prompt) }], active: 0 }];
          nextRootId = 1;
        }
      } else {
        // Check for ID collisions and log if found (indicates data corruption)
        const collisions = detectIdCollisions(nextNodes);
        if (collisions.hasCollisions) {
          console.warn('ID collisions detected in chat data:', {
            duplicateNodeIds: collisions.duplicateNodeIds,
            duplicateVariantIds: collisions.duplicateVariantIds,
          });
        }
        
        // Compute next IDs with collision prevention
        const ids = recomputeNextIds(nextNodes);
        const safeIds = ensureUniqueIds(nextNodes, ids.nextId, ids.nextNodeId);
        nextNextId = safeIds.nextId;
        nextNextNodeId = safeIds.nextNodeId;
      }
    } else {
      const prompt = resolveSystemPrompt(nextChatSettings?.presetId);
      nextNodes = [{ id: 1, variants: [{ ...makeSystemPrologue(1, prompt) }], active: 0 }];
      nextRootId = 1;
      nextNextId = 2;
      nextNextNodeId = 2;
      nextChatSettings = buildChatSettings(basePreset, nextSettings);
    }
  } catch {
    const prompt = resolveSystemPrompt(nextChatSettings?.presetId);
    nextNodes = [{ id: 1, variants: [{ ...makeSystemPrologue(1, prompt) }], active: 0 }];
    nextRootId = 1;
    nextNextId = 2;
    nextNextNodeId = 2;
    nextChatSettings = buildChatSettings(basePreset, nextSettings);
  }

  // Precompute a persist signature for the loaded chat content
  try {
    nextPersistSig = computePersistSig(nextNodes, nextChatSettings, nextRootId);
  } catch {
    nextPersistSig = '';
  }

  return {
    nodes: nextNodes,
    rootId: nextRootId,
    chatSettings: nextChatSettings,
    nextId: nextNextId,
    nextNodeId: nextNextNodeId,
    persistSig: nextPersistSig,
    settings: nextSettings
  };
}

