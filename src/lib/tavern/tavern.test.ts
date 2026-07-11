import { describe, it, expect } from 'vitest';
import { substituteMacros, buildMacroContext } from './macros.js';
import { normalizeCardJson } from './characterCard.js';
import {
  makeDefaultPromptPreset,
  ensurePromptPresetList,
  buildPromptInjections,
  exportPromptPreset,
  importPromptPreset,
  normalizePersona,
  ensurePersonaList,
  resolvePersona,
} from './promptPresets.js';
import type { Character, PromptPreset } from '../types/tavern.js';

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char_test',
    name: 'Miku',
    nickname: '',
    description: 'A cheerful catgirl.',
    personality: 'playful',
    scenario: 'A cozy tavern.',
    firstMes: 'Hello {{user}}!',
    alternateGreetings: ['Yo {{user}}.'],
    mesExample: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    creatorNotes: 'notes',
    creator: 'neko',
    characterVersion: '1.0',
    tags: ['catgirl'],
    avatar: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('macros', () => {
  it('substitutes {{char}} and {{user}} case-insensitively', () => {
    const out = substituteMacros('{{Char}} greets {{ USER }}', { char: 'Miku', user: 'Neko' });
    expect(out).toBe('Miku greets Neko');
  });

  it('supports aliases and legacy tags', () => {
    const out = substituteMacros('<BOT> and {{bot}} and <USER>', { char: 'Miku', user: 'Neko' });
    expect(out).toBe('Miku and Miku and Neko');
  });

  it('leaves unknown macros untouched', () => {
    expect(substituteMacros('{{original}} stays', { char: 'X' })).toBe('{{original}} stays');
  });

  it('prefers nickname over name for {{char}} (CCv3)', () => {
    const ctx = buildMacroContext({ name: 'Hatsune Miku', nickname: 'Miku' }, { name: 'Neko' });
    expect(ctx.char).toBe('Miku');
    expect(ctx.user).toBe('Neko');
  });
});

describe('normalizeCardJson', () => {
  it('parses a V1 flat card', () => {
    const card = normalizeCardJson({
      name: 'Miku',
      description: 'desc',
      personality: 'p',
      scenario: 's',
      first_mes: 'hi',
      mes_example: 'ex',
    });
    expect(card.name).toBe('Miku');
    expect(card.firstMes).toBe('hi');
    expect(card.alternateGreetings).toEqual([]);
  });

  it('parses a V2/V3 wrapped card and keeps sourceCard', () => {
    const card = normalizeCardJson({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Miku',
        nickname: 'Mi',
        description: 'desc',
        alternate_greetings: ['a', 'b'],
        extensions: { 'custom/key': true },
      },
    });
    expect(card.nickname).toBe('Mi');
    expect(card.alternateGreetings).toEqual(['a', 'b']);
    expect((card.sourceCard as Record<string, unknown>).extensions).toEqual({ 'custom/key': true });
  });

  it('throws on a card without a name', () => {
    expect(() => normalizeCardJson({ description: 'x' })).toThrow();
  });
});

describe('prompt presets', () => {
  it('ensurePromptPresetList falls back to the default preset', () => {
    const list = ensurePromptPresetList(null);
    expect(list.length).toBe(1);
    expect(list[0]!.blocks.some(b => b.marker === 'chatHistory')).toBe(true);
  });

  it('splits blocks around the chatHistory marker', () => {
    const preset: PromptPreset = {
      id: 'p',
      name: 'P',
      blocks: [
        { id: '1', name: 'Main', role: 'system', content: 'Main for {{char}}', enabled: true },
        { id: '2', name: 'History', role: 'system', content: '', enabled: true, marker: 'chatHistory' },
        { id: '3', name: 'Post', role: 'system', content: 'Stay concise.', enabled: true },
      ],
    };
    const { prefix, suffix } = buildPromptInjections(preset, makeCharacter(), { name: 'Neko', description: '' });
    expect(prefix.map(m => m.content)).toEqual(['Main for Miku']);
    expect(suffix.map(m => m.content)).toEqual(['Stay concise.']);
  });

  it('fills charDescription and persona markers, skips disabled blocks', () => {
    const preset = makeDefaultPromptPreset();
    preset.blocks = preset.blocks.map(b => (b.id === 'block-main' ? { ...b, enabled: false } : b));
    const { prefix } = buildPromptInjections(
      preset,
      makeCharacter(),
      { name: 'Neko', description: 'A quiet traveler.' }
    );
    const joined = prefix.map(m => m.content).join('\n');
    expect(joined).toContain('A cheerful catgirl.');
    expect(joined).toContain("Miku's personality: playful");
    expect(joined).toContain('Scenario: A cozy tavern.');
    expect(joined).toContain("Neko's persona: A quiet traveler.");
    expect(joined).not.toContain('fictional chat'); // main prompt disabled
  });

  it('card system_prompt replaces the main prompt and supports {{original}}', () => {
    const character = makeCharacter({ systemPrompt: 'CARD RULES. {{original}}' });
    const { prefix } = buildPromptInjections(makeDefaultPromptPreset(), character, { name: 'Neko', description: '' });
    expect(prefix[0]!.content.startsWith('CARD RULES. ')).toBe(true);
    expect(prefix[0]!.content).toContain("Write Miku's next reply");
  });

  it('card post_history_instructions replace the suffix with {{original}}', () => {
    const preset: PromptPreset = {
      id: 'p',
      name: 'P',
      blocks: [
        { id: '1', name: 'History', role: 'system', content: '', enabled: true, marker: 'chatHistory' },
        { id: '2', name: 'JB', role: 'system', content: 'user jb', enabled: true },
      ],
    };
    const character = makeCharacter({ postHistoryInstructions: 'PHI ({{original}})' });
    const { suffix } = buildPromptInjections(preset, character, null);
    expect(suffix).toEqual([{ role: 'system', content: 'PHI (user jb)' }]);
  });

  it('export/import round-trips a preset with a fresh id', () => {
    const preset = makeDefaultPromptPreset();
    const json = exportPromptPreset(preset);
    const imported = importPromptPreset(json);
    expect(imported.name).toBe(preset.name);
    expect(imported.blocks.length).toBe(preset.blocks.length);
    expect(imported.id).not.toBe(preset.id);
  });

  it('import rejects invalid payloads', () => {
    expect(() => importPromptPreset('not json')).toThrow();
    expect(() => importPromptPreset('{"foo":1}')).toThrow();
  });

  it('normalizePersona provides defaults', () => {
    expect(normalizePersona(null)).toEqual({ name: 'User', description: '' });
    expect(normalizePersona({ name: ' Neko ', description: 'd' })).toEqual({ name: 'Neko', description: 'd' });
  });
});

describe('personas list', () => {
  it('seeds the list from the legacy single persona', () => {
    const list = ensurePersonaList(null, { name: 'Neko', description: 'legacy' });
    expect(list).toEqual([{ id: 'persona-default', name: 'Neko', description: 'legacy' }]);
  });

  it('assigns unique ids and normalizes entries', () => {
    const list = ensurePersonaList([
      { id: 'a', name: 'One', description: '' },
      { id: 'a', name: 'Two', description: '' },
      { name: 'Three', description: '' },
    ]);
    expect(list.length).toBe(3);
    const ids = new Set(list.map(p => p.id));
    expect(ids.size).toBe(3);
  });

  it('resolvePersona picks the selected persona with fallback', () => {
    const list = ensurePersonaList([
      { id: 'a', name: 'One', description: '' },
      { id: 'b', name: 'Two', description: '' },
    ]);
    expect(resolvePersona(list, 'b').name).toBe('Two');
    expect(resolvePersona(list, 'missing').name).toBe('One');
  });
});
