// Character card parsing: SillyTavern / Character Card spec V1, V2 ("chara")
// and V3 ("ccv3") embedded in PNG tEXt chunks, plus plain JSON files.
import type { Character } from '../types/tavern.js';

export function generateCharacterId(): string {
  return `char_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// PNG chunk walking
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

interface TextChunk {
  keyword: string;
  text: string;
}

/** Extracts all tEXt chunks from a PNG byte array. */
function extractPngTextChunks(bytes: Uint8Array): TextChunk[] {
  const chunks: TextChunk[] = [];
  let offset = 8; // skip signature
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataEnd);
      const sep = data.indexOf(0);
      if (sep > 0) {
        // keyword is Latin-1; payload is base64 (ASCII) for card chunks
        let keyword = '';
        for (let i = 0; i < sep; i += 1) keyword += String.fromCharCode(data[i]!);
        let text = '';
        for (let i = sep + 1; i < data.length; i += 1) text += String.fromCharCode(data[i]!);
        chunks.push({ keyword: keyword.toLowerCase(), text });
      }
    }
    if (type === 'IEND') break;
    offset = dataEnd + 4; // skip CRC
  }
  return chunks;
}

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// ---------------------------------------------------------------------------
// Card JSON normalization (V1 flat / V2 / V3 { spec, data })
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && !!item.trim());
}

export interface ParsedCard {
  character: Character;
}

export function normalizeCardJson(json: unknown, avatar: string | null = null): Character {
  if (!json || typeof json !== 'object') {
    throw new Error('Character card payload is not an object.');
  }
  const root = json as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object')
    ? root.data as Record<string, unknown>
    : root;

  const name = asString(data.name).trim();
  if (!name) throw new Error('Character card has no name.');

  const now = Date.now();
  return {
    id: generateCharacterId(),
    name,
    nickname: asString(data.nickname),
    description: asString(data.description),
    personality: asString(data.personality),
    scenario: asString(data.scenario),
    firstMes: asString(data.first_mes),
    alternateGreetings: asStringArray(data.alternate_greetings),
    mesExample: asString(data.mes_example),
    systemPrompt: asString(data.system_prompt),
    postHistoryInstructions: asString(data.post_history_instructions),
    creatorNotes: asString(data.creator_notes) || asString(data.creatorcomment),
    creator: asString(data.creator),
    characterVersion: asString(data.character_version),
    tags: asStringArray(data.tags),
    avatar,
    // Keep the raw card data so unknown/optional fields (extensions,
    // character_book, assets, ...) are never destroyed (spec requirement).
    sourceCard: { ...data },
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Card export (Character Card V3 JSON, optionally embedded into the PNG)
// ---------------------------------------------------------------------------

/** Builds a spec-compliant CCv3 card object, preserving unknown source fields. */
export function characterToCardJson(character: Character): Record<string, unknown> {
  const source = (character.sourceCard && typeof character.sourceCard === 'object')
    ? character.sourceCard
    : {};
  const data: Record<string, unknown> = {
    // Preserved unknown/optional fields first, then our edited fields
    extensions: {},
    ...source,
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    first_mes: character.firstMes,
    mes_example: character.mesExample,
    creator_notes: character.creatorNotes,
    system_prompt: character.systemPrompt,
    post_history_instructions: character.postHistoryInstructions,
    alternate_greetings: character.alternateGreetings.slice(),
    tags: character.tags.slice(),
    creator: character.creator,
    character_version: character.characterVersion,
    group_only_greetings: Array.isArray((source as Record<string, unknown>).group_only_greetings)
      ? (source as Record<string, unknown>).group_only_greetings
      : [],
    creation_date: typeof source.creation_date === 'number'
      ? source.creation_date
      : Math.floor(character.createdAt / 1000),
    modification_date: Math.floor(Date.now() / 1000),
  };
  if (character.nickname) data.nickname = character.nickname;
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data,
  };
}

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// CRC32 (PNG variant) for writing tEXt chunks
let crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeTextChunk(keyword: string, text: string): Uint8Array {
  const payload = new Uint8Array(keyword.length + 1 + text.length);
  for (let i = 0; i < keyword.length; i += 1) payload[i] = keyword.charCodeAt(i) & 0xff;
  payload[keyword.length] = 0;
  for (let i = 0; i < text.length; i += 1) payload[keyword.length + 1 + i] = text.charCodeAt(i) & 0xff;

  const chunk = new Uint8Array(8 + payload.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk[4] = 0x74; chunk[5] = 0x45; chunk[6] = 0x58; chunk[7] = 0x74; // "tEXt"
  chunk.set(payload, 8);
  const crcInput = chunk.subarray(4, 8 + payload.length);
  view.setUint32(8 + payload.length, crc32(crcInput));
  return chunk;
}

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const match = /^data:[^;,]+;base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = atob(match[1]!);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Exports the character as a card file.
 * Returns a PNG (with fresh `ccv3` + backfilled `chara` tEXt chunks) when the
 * character has a PNG avatar, otherwise a JSON blob.
 */
export function exportCharacterCard(character: Character): { blob: Blob; filename: string } {
  const card = characterToCardJson(character);
  const safeName = (character.name || 'character').replace(/[^\w\- ]+/g, '').trim() || 'character';

  const avatarBytes = character.avatar ? dataUrlToBytes(character.avatar) : null;
  if (avatarBytes && isPng(avatarBytes)) {
    // Strip existing card chunks, then insert new ones right after IHDR
    const view = new DataView(avatarBytes.buffer, avatarBytes.byteOffset, avatarBytes.byteLength);
    const parts: Uint8Array[] = [avatarBytes.subarray(0, 8)];
    let offset = 8;
    const inserted: Uint8Array[] = [];
    while (offset + 8 <= avatarBytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(
        avatarBytes[offset + 4]!, avatarBytes[offset + 5]!, avatarBytes[offset + 6]!, avatarBytes[offset + 7]!
      );
      const end = offset + 8 + length + 4;
      if (end > avatarBytes.length) break;
      const chunkBytes = avatarBytes.subarray(offset, end);
      if (type === 'tEXt') {
        const data = avatarBytes.subarray(offset + 8, offset + 8 + length);
        const sep = data.indexOf(0);
        let keyword = '';
        for (let i = 0; i < (sep > 0 ? sep : 0); i += 1) keyword += String.fromCharCode(data[i]!);
        const kw = keyword.toLowerCase();
        if (kw === 'chara' || kw === 'ccv3') {
          offset = end;
          continue; // drop stale card chunks
        }
      }
      parts.push(chunkBytes);
      if (type === 'IHDR' && !inserted.length) {
        const v3Chunk = makeTextChunk('ccv3', encodeBase64Utf8(JSON.stringify(card)));
        const v2Card = {
          spec: 'chara_card_v2',
          spec_version: '2.0',
          data: (card as { data: Record<string, unknown> }).data,
        };
        const v2Chunk = makeTextChunk('chara', encodeBase64Utf8(JSON.stringify(v2Card)));
        parts.push(v3Chunk, v2Chunk);
        inserted.push(v3Chunk);
      }
      offset = end;
      if (type === 'IEND') break;
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const part of parts) {
      out.set(part, pos);
      pos += part.length;
    }
    return {
      blob: new Blob([out], { type: 'image/png' }),
      filename: `${safeName}.png`,
    };
  }

  return {
    blob: new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' }),
    filename: `${safeName}.json`,
  };
}

/** Creates a blank character for the editor's "New character" flow. */
export function makeBlankCharacter(): Character {
  const now = Date.now();
  return {
    id: generateCharacterId(),
    name: '',
    nickname: '',
    description: '',
    personality: '',
    scenario: '',
    firstMes: '',
    alternateGreetings: [],
    mesExample: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    creatorNotes: '',
    creator: '',
    characterVersion: '',
    tags: [],
    avatar: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// File-level entry point
// ---------------------------------------------------------------------------

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** Parses a character card file (.png with embedded card, or .json). */
export async function parseCharacterFile(file: File): Promise<Character> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (isPng(bytes)) {
    const chunks = extractPngTextChunks(bytes);
    // Prefer V3 (ccv3), fall back to V2/V1 (chara)
    const cardChunk = chunks.find(c => c.keyword === 'ccv3')
      || chunks.find(c => c.keyword === 'chara');
    if (!cardChunk) {
      throw new Error('No character card data found in this PNG.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeBase64Utf8(cardChunk.text));
    } catch {
      throw new Error('Failed to decode character card data from PNG.');
    }
    const avatar = bytesToDataUrl(bytes, 'image/png');
    return normalizeCardJson(parsed, avatar);
  }

  // Plain JSON card
  try {
    const text = new TextDecoder('utf-8').decode(bytes);
    return normalizeCardJson(JSON.parse(text), null);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Character card')) throw err;
    throw new Error('Unsupported file: expected a card PNG or JSON.');
  }
}
