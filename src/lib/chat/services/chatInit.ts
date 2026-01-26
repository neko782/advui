// Chat initialization and preset management
import { loadSettings } from '../../settingsStore.js';
import {
  DEFAULT_SYSTEM_PROMPT,
  normalizePreset as normalizePresetHelper,
  buildChatSettings as buildChatSettingsHelper,
  computeConnectionId
} from '../../utils/presetHelpers.js';
import type { Preset, ChatSettings, Settings, ChatNode, MessageVariant } from '../../types/index.js';

export { DEFAULT_SYSTEM_PROMPT };

export function makeSystemPrologue(idBase: number = 1, prompt: string = DEFAULT_SYSTEM_PROMPT): MessageVariant {
  return {
    id: idBase,
    role: 'system',
    content: typeof prompt === 'string' ? prompt : DEFAULT_SYSTEM_PROMPT,
    time: Date.now(),
    typing: false,
    error: undefined,
    next: null,
  };
}

export function normalizePreset(preset: unknown): Preset {
  // Delegate entirely to normalizePresetHelper to avoid field duplication.
  // When adding new Preset fields, update normalizePreset in presetHelpers.ts
  return normalizePresetHelper(preset, 0, {});
}

export function pickPresetFromSettings(state: Partial<Settings> | null): Preset {
  const list = Array.isArray(state?.presets) ? state.presets : [];
  if (typeof state?.selectedPresetId === 'string') {
    const sel = list.find(p => p?.id === state.selectedPresetId);
    if (sel) return normalizePreset(sel);
  }
  if (list.length) return normalizePreset(list[0]);
  return normalizePreset(null);
}

export function presetSignature(state: Partial<Settings> | null): string {
  const list = Array.isArray(state?.presets) ? state.presets : [];
  return list.map(p => [
    p?.id || '',
    p?.name || '',
    p?.model || '',
    typeof p?.streaming === 'boolean' ? (p.streaming ? 1 : 0) : 1,
    p?.maxOutputTokens ?? '',
    p?.topP ?? '',
    p?.temperature ?? '',
    p?.reasoningEffort || '',
    p?.textVerbosity || '',
    p?.reasoningSummary || '',
    p?.thinkingEnabled ? '1' : '0',
    p?.thinkingBudgetTokens ?? '',
    p?.connectionId || '',
    p?.systemPrompt || '',
  ].join('|')).join(';');
}

export function computeInitialConnectionId(preset: Partial<Preset> | null, settings: Partial<Settings> | null): string | null {
  return computeConnectionId({
    preset,
    settings,
  });
}

export function buildChatSettings(preset: Preset, settings: Partial<Settings> | null): ChatSettings {
  return buildChatSettingsHelper(preset, settings);
}

export interface NextIdsResult {
  nextId: number;
  nextNodeId: number;
}

/**
 * ID collision detection result
 */
export interface IdCollisionResult {
  hasCollisions: boolean;
  duplicateNodeIds: number[];
  duplicateVariantIds: number[];
}

/**
 * Detects ID collisions in nodes and variants
 */
export function detectIdCollisions(nodes: ChatNode[] | null): IdCollisionResult {
  const nodeIdCounts = new Map<number, number>();
  const variantIdCounts = new Map<number, number>();
  
  for (const n of nodes || []) {
    const nodeId = Number(n?.id);
    if (Number.isFinite(nodeId)) {
      nodeIdCounts.set(nodeId, (nodeIdCounts.get(nodeId) || 0) + 1);
    }
    for (const v of n?.variants || []) {
      const variantId = Number(v?.id);
      if (Number.isFinite(variantId)) {
        variantIdCounts.set(variantId, (variantIdCounts.get(variantId) || 0) + 1);
      }
    }
  }

  const duplicateNodeIds: number[] = [];
  const duplicateVariantIds: number[] = [];

  for (const [id, count] of nodeIdCounts.entries()) {
    if (count > 1) duplicateNodeIds.push(id);
  }
  for (const [id, count] of variantIdCounts.entries()) {
    if (count > 1) duplicateVariantIds.push(id);
  }

  return {
    hasCollisions: duplicateNodeIds.length > 0 || duplicateVariantIds.length > 0,
    duplicateNodeIds,
    duplicateVariantIds,
  };
}

/**
 * Validates that proposed new IDs don't collide with existing ones.
 * Returns safe IDs that are guaranteed to be unique.
 */
export function ensureUniqueIds(
  nodes: ChatNode[] | null,
  proposedNextId: number,
  proposedNextNodeId: number
): NextIdsResult {
  const existingNodeIds = new Set<number>();
  const existingVariantIds = new Set<number>();

  for (const n of nodes || []) {
    const nodeId = Number(n?.id);
    if (Number.isFinite(nodeId)) existingNodeIds.add(nodeId);
    for (const v of n?.variants || []) {
      const variantId = Number(v?.id);
      if (Number.isFinite(variantId)) existingVariantIds.add(variantId);
    }
  }

  let safeNextId = proposedNextId;
  let safeNextNodeId = proposedNextNodeId;

  // Ensure nextId doesn't collide
  while (existingVariantIds.has(safeNextId)) {
    safeNextId++;
  }

  // Ensure nextNodeId doesn't collide
  while (existingNodeIds.has(safeNextNodeId)) {
    safeNextNodeId++;
  }

  return { nextId: safeNextId, nextNodeId: safeNextNodeId };
}

export function recomputeNextIds(nodes: ChatNode[] | null): NextIdsResult {
  try {
    const maxMsgId = (nodes || []).reduce((mx, n) => {
      const vMax = (n?.variants || []).reduce((m2, v) => Math.max(m2, Number(v?.id) || 0), 0);
      return Math.max(mx, vMax);
    }, 0);
    const maxNodeId = (nodes || []).reduce((mx, n) => Math.max(mx, Number(n?.id) || 0), 0);
    
    // Validate no collisions and return safe IDs
    const proposed = { nextId: maxMsgId + 1, nextNodeId: maxNodeId + 1 };
    return ensureUniqueIds(nodes, proposed.nextId, proposed.nextNodeId);
  } catch {
    return { nextId: 1, nextNodeId: 1 };
  }
}

