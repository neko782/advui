// Reactive application state (Svelte 5 runes).
// Replaces settingsVersion counters, appSettings prop-drilling and
// onGeneratingChange callback chains.

import { loadSettings, saveSettings as persistSettings } from '../settingsStore.js';
import type { Settings } from '../types/index.js';

// ============================================================================
// Settings store — single reactive source of truth for app settings.
// Persistence still lives in settingsStore.ts (localStorage).
// ============================================================================

class SettingsStore {
  current = $state<Settings>(loadSettings());

  /** Re-reads settings from storage (e.g. after the settings modal saves). */
  reload(): Settings {
    this.current = loadSettings();
    return this.current;
  }

  /** Persists and updates the reactive value. */
  save(next: Partial<Settings>): Settings {
    const saved = persistSettings(next);
    this.current = saved;
    return saved;
  }
}

export const settingsStore = new SettingsStore();

// ============================================================================
// Generation registry — which chats have a generation in flight.
// ============================================================================

class GenerationRegistry {
  map = $state<Record<string, boolean>>({});

  setGenerating(chatId: string, isGenerating: boolean): void {
    if (!chatId) return;
    if (isGenerating) {
      if (this.map[chatId]) return;
      this.map = { ...this.map, [chatId]: true };
      return;
    }
    if (!this.map[chatId]) return;
    const next = { ...this.map };
    delete next[chatId];
    this.map = next;
  }

  isGenerating(chatId: string): boolean {
    return !!this.map[chatId];
  }

  /** Drops entries for chats that no longer exist. */
  prune(activeIds: Array<string | null | undefined>): void {
    const allowed = new Set(activeIds.filter(Boolean));
    let changed = false;
    const next = { ...this.map };
    for (const id of Object.keys(this.map)) {
      if (!allowed.has(id)) {
        delete next[id];
        changed = true;
      }
    }
    if (changed) this.map = next;
  }
}

export const generationRegistry = new GenerationRegistry();
