// Tavern preset selection: tavern chats keep their own selected (connection)
// preset, independent from chat mode, unless sharing is explicitly enabled.
import type { Settings } from '../types/settings.js';

export function resolveTavernPresetId(settings: Partial<Settings> | null): string | null {
  if (settings?.tavernSharePresetSelection) {
    return typeof settings?.selectedPresetId === 'string' ? settings.selectedPresetId : null;
  }
  if (typeof settings?.tavernSelectedPresetId === 'string' && settings.tavernSelectedPresetId) {
    return settings.tavernSelectedPresetId;
  }
  return typeof settings?.selectedPresetId === 'string' ? settings.selectedPresetId : null;
}
