// SillyTavern-style macro substitution ({{char}}, {{user}}, ...).
// Applied at prompt-build time (and when instantiating greetings) so that
// stored text keeps the raw macros.
import type { MacroContext } from '../types/tavern.js';

const MACRO_ALIASES: Record<string, keyof MacroContext> = {
  char: 'char',
  bot: 'char',
  charname: 'char',
  user: 'user',
  username: 'user',
  description: 'description',
  personality: 'personality',
  scenario: 'scenario',
  persona: 'persona',
};

export function substituteMacros(text: string, ctx: MacroContext = {}): string {
  if (typeof text !== 'string' || !text) return typeof text === 'string' ? text : '';
  let out = text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, rawKey: string) => {
    const key = MACRO_ALIASES[rawKey.toLowerCase()];
    if (!key) return match;
    const value = ctx[key];
    return typeof value === 'string' ? value : match;
  });
  // Legacy tags used by some old cards
  if (typeof ctx.char === 'string') {
    out = out.replace(/<BOT>/gi, ctx.char).replace(/<CHAR>/gi, ctx.char);
  }
  if (typeof ctx.user === 'string') {
    out = out.replace(/<USER>/gi, ctx.user);
  }
  return out;
}

export function buildMacroContext(
  character: { name?: string; nickname?: string; description?: string; personality?: string; scenario?: string } | null,
  persona: { name?: string; description?: string } | null
): MacroContext {
  const userName = (persona?.name || '').trim() || 'User';
  return {
    // CCv3: {{char}} uses nickname when present, else name
    char: (character?.nickname || '').trim() || (character?.name || '').trim() || 'Assistant',
    user: userName,
    description: character?.description || '',
    personality: character?.personality || '',
    scenario: character?.scenario || '',
    persona: persona?.description || '',
  };
}
