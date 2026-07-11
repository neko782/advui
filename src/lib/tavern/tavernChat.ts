// Creating chats bound to a character: the greeting (first_mes) becomes the
// root assistant message and alternate greetings become variants of it, which
// maps 1:1 onto advui's branching/variant graph ("swipes").
import { createChat } from '../chatsStore.js';
import { substituteMacros, buildMacroContext } from './macros.js';
import { resolveTavernPresetId } from './tavernPreset.js';
import type { Character, Persona } from '../types/tavern.js';
import type { Chat, ChatNode, MessageVariant, Settings } from '../types/index.js';

export async function createCharacterChat(
  character: Character,
  settings: Partial<Settings> | null
): Promise<{ id: string; chat: Chat }> {
  const ctx = buildMacroContext(character, (settings?.persona as Persona) || null);
  const greetings = [character.firstMes, ...(character.alternateGreetings || [])]
    .filter((g): g is string => typeof g === 'string' && !!g.trim());

  const now = Date.now();
  const variants: MessageVariant[] = greetings.map((greeting, index) => ({
    id: index + 1,
    role: 'assistant',
    content: substituteMacros(greeting.trim(), ctx),
    time: now,
    typing: false,
    error: undefined,
    next: null,
  }));

  const nodes: ChatNode[] = variants.length
    ? [{ id: 1, variants, active: 0 }]
    : [];

  return await createChat({
    nodes,
    rootId: nodes.length ? 1 : null,
    characterId: character.id,
    presetId: resolveTavernPresetId(settings) || undefined,
    title: character.name || 'New Chat',
  });
}
