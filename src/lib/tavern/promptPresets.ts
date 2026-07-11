// Prompt presets: ordered, shareable prompt block stacks (SillyTavern-style).
// Blocks before the "Chat History" marker are prepended to the request
// history; blocks after it are appended (post-history instructions).
import { substituteMacros, buildMacroContext } from './macros.js';
import type {
  PromptPreset,
  PromptBlock,
  PromptBlockRole,
  Persona,
  Character,
  MacroContext,
} from '../types/tavern.js';
import type { HistoryMessage } from '../types/api.js';

const VALID_ROLES: ReadonlySet<string> = new Set(['system', 'user', 'assistant']);
const VALID_MARKERS: ReadonlySet<string> = new Set(['chatHistory', 'charDescription', 'persona']);

export function generatePromptPresetId(): string {
  return `prompt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generatePromptBlockId(): string {
  return `block_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const DEFAULT_MAIN_PROMPT =
  "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}. "
  + 'Stay in character, be creative, and move the story forward. '
  + 'Avoid writing actions or dialogue for {{user}}.';

export function makeDefaultPromptPreset(): PromptPreset {
  return {
    id: 'prompt-default',
    name: 'Default',
    blocks: [
      {
        id: 'block-main',
        name: 'Main Prompt',
        role: 'system',
        content: DEFAULT_MAIN_PROMPT,
        enabled: true,
      },
      {
        id: 'block-char',
        name: 'Character Description',
        role: 'system',
        content: '',
        enabled: true,
        marker: 'charDescription',
      },
      {
        id: 'block-persona',
        name: 'Persona',
        role: 'system',
        content: '',
        enabled: true,
        marker: 'persona',
      },
      {
        id: 'block-history',
        name: 'Chat History',
        role: 'system',
        content: '',
        enabled: true,
        marker: 'chatHistory',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizePromptBlock(raw: unknown, index: number = 0): PromptBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const role: PromptBlockRole = VALID_ROLES.has(obj.role as string)
    ? obj.role as PromptBlockRole
    : 'system';
  const marker = VALID_MARKERS.has(obj.marker as string)
    ? obj.marker as PromptBlock['marker']
    : undefined;
  const block: PromptBlock = {
    id: (typeof obj.id === 'string' && obj.id.trim()) ? obj.id.trim() : generatePromptBlockId(),
    name: (typeof obj.name === 'string' && obj.name.trim()) ? obj.name.trim() : `Block ${index + 1}`,
    role,
    content: typeof obj.content === 'string' ? obj.content : '',
    enabled: obj.enabled !== false,
  };
  if (marker) block.marker = marker;
  return block;
}

export function normalizePromptPreset(raw: unknown, index: number = 0): PromptPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const blocksRaw = Array.isArray(obj.blocks) ? obj.blocks : [];
  const blocks = blocksRaw
    .map((block, i) => normalizePromptBlock(block, i))
    .filter((block): block is PromptBlock => !!block);
  return {
    id: (typeof obj.id === 'string' && obj.id.trim()) ? obj.id.trim() : generatePromptPresetId(),
    name: (typeof obj.name === 'string' && obj.name.trim()) ? obj.name.trim() : `Prompt ${index + 1}`,
    blocks,
  };
}

export function ensurePromptPresetList(list: unknown): PromptPreset[] {
  const arr = Array.isArray(list) ? list : [];
  const normalized = arr
    .map((item, index) => normalizePromptPreset(item, index))
    .filter((item): item is PromptPreset => !!item);
  if (!normalized.length) return [makeDefaultPromptPreset()];
  const seen = new Set<string>();
  return normalized.map((preset) => {
    let id = preset.id;
    while (seen.has(id)) id = generatePromptPresetId();
    seen.add(id);
    return { ...preset, id };
  });
}

export function normalizePersona(raw: unknown): Persona {
  if (!raw || typeof raw !== 'object') return { name: 'User', description: '' };
  const obj = raw as Record<string, unknown>;
  const persona: Persona = {
    name: (typeof obj.name === 'string' && obj.name.trim()) ? obj.name.trim() : 'User',
    description: typeof obj.description === 'string' ? obj.description : '',
  };
  if (typeof obj.id === 'string' && obj.id.trim()) persona.id = obj.id.trim();
  return persona;
}

export function generatePersonaId(): string {
  return `persona_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalizes the personas list. Seeds it from the legacy single `persona`
 * settings field when the list is missing/empty.
 */
export function ensurePersonaList(list: unknown, legacy?: unknown): Persona[] {
  const arr = Array.isArray(list) ? list : [];
  let normalized = arr
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalizePersona(item));
  if (!normalized.length) {
    const seed = normalizePersona(legacy);
    normalized = [{ ...seed, id: 'persona-default' }];
  }
  const seen = new Set<string>();
  return normalized.map((persona) => {
    let id = persona.id || generatePersonaId();
    while (seen.has(id)) id = generatePersonaId();
    seen.add(id);
    return { ...persona, id };
  });
}

export function resolvePersona(
  personas: Persona[] | undefined,
  selectedId: string | undefined
): Persona {
  const list = Array.isArray(personas) && personas.length ? personas : ensurePersonaList(null);
  return list.find(p => p?.id === selectedId) || list[0]!;
}

export function resolvePromptPreset(
  presets: PromptPreset[] | undefined,
  selectedId: string | undefined
): PromptPreset {
  const list = Array.isArray(presets) && presets.length ? presets : [makeDefaultPromptPreset()];
  return list.find(p => p?.id === selectedId) || list[0]!;
}

// ---------------------------------------------------------------------------
// Prompt injection building
// ---------------------------------------------------------------------------

function buildCharDescriptionContent(character: Character, ctx: MacroContext): string {
  const parts: string[] = [];
  if (character.description?.trim()) parts.push(character.description.trim());
  if (character.personality?.trim()) parts.push(`{{char}}'s personality: ${character.personality.trim()}`);
  if (character.scenario?.trim()) parts.push(`Scenario: ${character.scenario.trim()}`);
  if (character.mesExample?.trim()) parts.push(`Example dialogue:\n${character.mesExample.trim()}`);
  return substituteMacros(parts.join('\n\n'), ctx);
}

/**
 * Spec (CCv2): a card's `system_prompt`/`post_history_instructions` replace
 * the frontend's own prompt by default; `{{original}}` inside them refers to
 * what would have been used instead.
 */
function applyOriginal(cardPrompt: string, original: string, ctx: MacroContext): string {
  const withOriginal = cardPrompt.replace(/\{\{\s*original\s*\}\}/gi, original);
  return substituteMacros(withOriginal, ctx);
}

function buildPersonaContent(persona: Persona, ctx: MacroContext): string {
  const description = persona?.description?.trim();
  if (!description) return '';
  return substituteMacros(`{{user}}'s persona: ${description}`, ctx);
}

export interface PromptInjections {
  prefix: HistoryMessage[];
  suffix: HistoryMessage[];
}

/**
 * Builds the messages injected around the chat history for a character chat.
 * Blocks before the chatHistory marker go into `prefix`, blocks after it into
 * `suffix`. If no chatHistory marker exists, everything goes into `prefix`.
 */
export function buildPromptInjections(
  preset: PromptPreset,
  character: Character | null,
  persona: Persona | null
): PromptInjections {
  const ctx = buildMacroContext(character, persona);
  const prefix: HistoryMessage[] = [];
  const suffix: HistoryMessage[] = [];
  let target = prefix;

  const cardSystemPrompt = character?.systemPrompt?.trim() || '';
  let cardSystemPromptApplied = false;

  const blocks = Array.isArray(preset?.blocks) ? preset.blocks : [];
  for (const block of blocks) {
    if (!block?.enabled) {
      if (block?.marker === 'chatHistory') target = suffix;
      continue;
    }
    if (block.marker === 'chatHistory') {
      target = suffix;
      continue;
    }
    let content = '';
    if (block.marker === 'charDescription') {
      content = character ? buildCharDescriptionContent(character, ctx) : '';
    } else if (block.marker === 'persona') {
      content = persona ? buildPersonaContent(persona, ctx) : '';
    } else {
      content = substituteMacros(block.content || '', ctx);
      // Spec: card system_prompt replaces the frontend's main prompt by
      // default; {{original}} refers to the replaced prompt. We apply it to
      // the first plain system block before the chat history.
      if (cardSystemPrompt && !cardSystemPromptApplied && target === prefix && block.role === 'system') {
        content = applyOriginal(cardSystemPrompt, content, ctx);
        cardSystemPromptApplied = true;
      }
    }
    if (content.trim()) {
      target.push({ role: block.role, content });
    }
  }

  // Card had a system_prompt but the preset had no plain system block to
  // replace: inject it at the top so the card's instructions still apply.
  if (cardSystemPrompt && !cardSystemPromptApplied) {
    prefix.unshift({ role: 'system', content: applyOriginal(cardSystemPrompt, '', ctx) });
  }

  // Spec: card post_history_instructions replace the user's own post-history
  // ("jailbreak") blocks; {{original}} refers to what they replaced.
  const cardPhi = character?.postHistoryInstructions?.trim() || '';
  if (cardPhi) {
    const originalSuffix = suffix.map(m => m.content).join('\n\n');
    suffix.length = 0;
    suffix.push({ role: 'system', content: applyOriginal(cardPhi, originalSuffix, ctx) });
  }

  return { prefix, suffix };
}

// ---------------------------------------------------------------------------
// Sharing (export/import). Prompt presets contain no secrets, so they are
// safe to share. Connection presets are intentionally NOT exportable.
// ---------------------------------------------------------------------------

export interface PromptPresetExport {
  type: 'advui.promptPreset';
  version: 1;
  preset: PromptPreset;
}

export function exportPromptPreset(preset: PromptPreset): string {
  const payload: PromptPresetExport = {
    type: 'advui.promptPreset',
    version: 1,
    preset,
  };
  return JSON.stringify(payload, null, 2);
}

export function importPromptPreset(jsonText: string): PromptPreset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid JSON file.');
  }
  const obj = (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
  // Accept both wrapped exports and bare presets
  const candidate = (obj.type === 'advui.promptPreset' && obj.preset && typeof obj.preset === 'object')
    ? obj.preset
    : parsed;
  const normalized = normalizePromptPreset(candidate);
  if (!normalized || !normalized.blocks.length) {
    throw new Error('File does not contain a valid prompt preset.');
  }
  // Always assign a fresh id on import to avoid collisions
  return { ...normalized, id: generatePromptPresetId() };
}
