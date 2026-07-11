// ============================================================================
// Tavern Types
// Character cards, personas, prompt presets (shareable prompt block stacks).
// ============================================================================

/** A character imported from a SillyTavern-compatible card (V1/V2/V3). */
export interface Character {
  id: string;
  name: string;
  /** CCv3: replaces {{char}} in prompts when set. */
  nickname: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  alternateGreetings: string[];
  mesExample: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  creatorNotes: string;
  creator: string;
  characterVersion: string;
  tags: string[];
  /** Data URL of the card image (usually the imported PNG). */
  avatar: string | null;
  /**
   * Raw `data` object from the imported card. Kept so unknown/optional fields
   * (extensions, character_book, assets, ...) survive a round trip, as the
   * card specs require.
   */
  sourceCard?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** Marker blocks are placeholders filled at send time. */
export type PromptBlockMarker = 'chatHistory' | 'charDescription' | 'persona';

export type PromptBlockRole = 'system' | 'user' | 'assistant';

export interface PromptBlock {
  id: string;
  name: string;
  role: PromptBlockRole;
  content: string;
  enabled: boolean;
  marker?: PromptBlockMarker;
}

/** Shareable, ordered prompt stack. Contains no secrets. */
export interface PromptPreset {
  id: string;
  name: string;
  blocks: PromptBlock[];
}

export interface Persona {
  /** Present for personas stored in the personas list. */
  id?: string;
  name: string;
  description: string;
}

/** Context used for macro substitution when building prompts. */
export interface MacroContext {
  char?: string;
  user?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  persona?: string;
}
