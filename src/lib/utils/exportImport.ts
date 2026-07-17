// Utility functions for exporting and importing chat data
import type {
  Chat,
  ExportedChat,
  ImportResult,
  ChatManifestEntry,
  ImageManifestEntry,
  TarArchive,
  Settings
} from '../types/index.js';

import { getChatListItems, getChat, createChat } from '../chatsStore.js';
import { loadSettings, saveSettings } from '../settingsStore.js';
import { getAllImages, storeImage } from '../imageStore.js';
import Tar from 'tar-js';
import untar from 'js-untar';

interface FileSystemWriteStream {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?: () => Promise<void>;
}

/**
 * Export a single chat as JSON
 */
export async function exportChat(chatId: string): Promise<void> {
  try {
    const chat = await getChat(chatId);
    if (!chat) {
      throw new Error('Chat not found');
    }

    const exportData: ExportedChat = {
      version: 1,
      type: 'single_chat',
      exportedAt: new Date().toISOString(),
      chat
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const fileName = `chat_${sanitizeFilename(chat.title || 'untitled')}_${Date.now()}.json`;
    downloadFile(url, fileName);

    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Failed to export chat:', err);
    throw err;
  }
}

/**
 * Import a single chat from JSON file
 */
export async function importChat(file: File): Promise<{ id: string; chat: Chat }> {
  try {
    const text = await file.text();
    const data = JSON.parse(text) as ExportedChat;

    if (data.type !== 'single_chat' || !data.chat) {
      throw new Error('Invalid chat export file');
    }

    const chat = data.chat;

    // Create a new chat with the imported data
    const result = await createChat({
      nodes: chat.nodes,
      rootId: chat.rootId,
      settings: chat.settings,
      presetId: chat.presetId || undefined,
      updatedAt: chat.updatedAt,
      title: chat.title || undefined
    });

    return result;
  } catch (err) {
    console.error('Failed to import chat:', err);
    throw err;
  }
}

export interface ExportAllDataOptions {
  includeMedia?: boolean;
}

export interface ExportSizeEstimate {
  bytes: number;
  chatCount: number;
  sampledChatCount: number;
  includesMedia: boolean;
  mediaEstimated: boolean;
}

/**
 * Export all data as a TAR archive. Media is skipped unless explicitly requested.
 */
export async function exportAllData(options: ExportAllDataOptions = {}): Promise<void> {
  try {
    const includeMedia = options.includeMedia === true;
    const fileName = `advui_backup_${Date.now()}.tar`;

    if (canStreamDownload()) {
      await streamExportArchive(fileName, includeMedia);
      return;
    }

    const tar = new Tar();
    await appendExportArchiveToTar(tar, includeMedia);

    const tarData = tar.out;
    const blob = new Blob([tarData], { type: 'application/x-tar' });
    const url = URL.createObjectURL(blob);

    downloadFile(url, fileName);

    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Failed to export all data:', err);
    throw err;
  }
}

export async function estimateExportAllDataSize(options: ExportAllDataOptions = {}): Promise<ExportSizeEstimate> {
  const includeMedia = options.includeMedia === true;
  const chatItems = (await getChatListItems()).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const exportedAt = new Date().toISOString();
  const usedChatPaths = new Set<string>();
  const manifestEntries: ChatManifestEntry[] = [];
  // Sample chats spread evenly across the list instead of only the most
  // recent ones, so a single unusually large chat doesn't skew the
  // extrapolated average for every other chat.
  const sampleSize = Math.min(10, chatItems.length);
  const sampleIndexes = new Set<number>();
  if (sampleSize > 0) {
    const step = chatItems.length / sampleSize;
    for (let i = 0; i < sampleSize; i++) {
      sampleIndexes.add(Math.min(chatItems.length - 1, Math.floor(i * step)));
    }
  }
  let sampledChatBytes = 0;
  let sampledChatCount = 0;
  let chatEntryTotal = 0;

  for (let index = 0; index < chatItems.length; index++) {
    const item = chatItems[index]!;
    const filename = buildChatArchivePath(item, index, usedChatPaths);
    manifestEntries.push({
      id: item.id,
      title: item.title,
      path: filename,
      order: index,
      updatedAt: item.updatedAt
    });

    if (sampleIndexes.has(index)) {
      const chat = await getChat(item.id);
      if (chat) {
        const payload: ExportedChat = {
          version: 1,
          type: 'single_chat',
          exportedAt,
          chat
        };
        const entryBytes = encodedLength(JSON.stringify(payload, null, 2));
        sampledChatBytes += entryBytes;
        sampledChatCount++;
        chatEntryTotal += tarEntrySize(entryBytes);
      }
    }
  }

  const averageChatBytes = sampledChatCount > 0 ? Math.ceil(sampledChatBytes / sampledChatCount) : 0;
  const unsampledCount = Math.max(0, chatItems.length - sampledChatCount);
  chatEntryTotal += unsampledCount * tarEntrySize(averageChatBytes);

  const settingsData = {
    version: 1,
    exportedAt,
    settings: loadSettings()
  };
  let totalBytes = tarEntrySize(encodedLength(JSON.stringify(settingsData, null, 2))) + chatEntryTotal + 1024;

  if (manifestEntries.length > 0) {
    const manifestBytes = encodedLength(
      JSON.stringify(
        {
          version: 1,
          exportedAt,
          chats: manifestEntries
        },
        null,
        2
      )
    );
    totalBytes += tarEntrySize(manifestBytes);
  }

  return {
    bytes: totalBytes,
    chatCount: chatItems.length,
    sampledChatCount,
    includesMedia: includeMedia,
    mediaEstimated: false
  };
}

async function appendExportArchiveToTar(tar: Tar, includeMedia: boolean): Promise<void> {
  const chatItems = (await getChatListItems()).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const exportedAt = new Date().toISOString();
  const chatManifest: ChatManifestEntry[] = [];
  const usedChatPaths = new Set<string>();

  for (let index = 0; index < chatItems.length; index++) {
    const item = chatItems[index]!;
    const chat = await getChat(item.id);
    if (!chat) continue;
    const filename = buildChatArchivePath(item, index, usedChatPaths);

    const chatPayload: ExportedChat = {
      version: 1,
      type: 'single_chat',
      exportedAt,
      chat
    };

    tar.append(filename, encodeText(JSON.stringify(chatPayload, null, 2)));

    chatManifest.push({
      id: chat.id,
      title: chat.title,
      path: filename,
      order: index,
      updatedAt: chat.updatedAt
    });
  }

  if (chatManifest.length > 0) {
    tar.append(
      'chats/manifest.json',
      encodeText(
        JSON.stringify(
          {
            version: 1,
            exportedAt,
            chats: chatManifest
          },
          null,
          2
        )
      )
    );
  }

  const settings = loadSettings();
  const settingsData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings
  };
  tar.append('settings.json', encodeText(JSON.stringify(settingsData, null, 2)));

  if (includeMedia) {
    try {
      const images = await getAllImages();
      if (images && images.length > 0) {
        const imagesManifest: ImageManifestEntry[] = [];

        for (const image of images) {
          if (image.data && image.id) {
            const ext = getExtensionFromMimeType(image.mimeType) || 'dat';
            const filename = `${image.id}.${ext}`;
            const normalizedData = normalizeBase64Data(image.data);

            tar.append(`images/${filename}`, base64ToBytes(normalizedData));

            imagesManifest.push({
              id: image.id,
              filename,
              mimeType: image.mimeType,
              name: image.name
            });
          }
        }

        tar.append('images/manifest.json', encodeText(JSON.stringify({ version: 1, images: imagesManifest }, null, 2)));
      }
    } catch (err) {
      console.warn('Failed to export images:', err);
    }
  }
}

async function streamExportArchive(fileName: string, includeMedia: boolean): Promise<void> {
  const picker = window as unknown as {
    showSaveFilePicker?: (options?: unknown) => Promise<{
      createWritable: () => Promise<FileSystemWriteStream>;
    }>;
  };
  const handle = await picker.showSaveFilePicker?.({
    suggestedName: fileName,
    types: [
      {
        description: 'TAR archive',
        accept: { 'application/x-tar': ['.tar'] }
      }
    ]
  });
  if (!handle) {
    throw new Error('Streaming downloads are not available in this browser');
  }

  const writer = await handle.createWritable();
  try {
    await appendExportArchiveToStream(writer, includeMedia);
    await writer.close();
  } catch (err) {
    await writer.abort?.();
    throw err;
  }
}

async function appendExportArchiveToStream(writer: FileSystemWriteStream, includeMedia: boolean): Promise<void> {
  const chatItems = (await getChatListItems()).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const exportedAt = new Date().toISOString();
  const chatManifest: ChatManifestEntry[] = [];
  const usedChatPaths = new Set<string>();

  for (let index = 0; index < chatItems.length; index++) {
    const item = chatItems[index]!;
    const chat = await getChat(item.id);
    if (!chat) continue;
    const filename = buildChatArchivePath(item, index, usedChatPaths);

    const chatPayload: ExportedChat = {
      version: 1,
      type: 'single_chat',
      exportedAt,
      chat
    };

    await writeTarTextEntry(writer, filename, JSON.stringify(chatPayload, null, 2));

    chatManifest.push({
      id: chat.id,
      title: chat.title,
      path: filename,
      order: index,
      updatedAt: chat.updatedAt
    });
  }

  if (chatManifest.length > 0) {
    await writeTarTextEntry(
      writer,
      'chats/manifest.json',
      JSON.stringify(
        {
          version: 1,
          exportedAt,
          chats: chatManifest
        },
        null,
        2
      )
    );
  }

  const settingsData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: loadSettings()
  };
  await writeTarTextEntry(writer, 'settings.json', JSON.stringify(settingsData, null, 2));

  if (includeMedia) {
    try {
      const images = await getAllImages();
      if (images && images.length > 0) {
        const imagesManifest: ImageManifestEntry[] = [];

        for (const image of images) {
          if (image.data && image.id) {
            const ext = getExtensionFromMimeType(image.mimeType) || 'dat';
            const filename = `${image.id}.${ext}`;
            const normalizedData = normalizeBase64Data(image.data);

            await writeTarBytesEntry(writer, `images/${filename}`, base64ToBytes(normalizedData));

            imagesManifest.push({
              id: image.id,
              filename,
              mimeType: image.mimeType,
              name: image.name
            });
          }
        }

        await writeTarTextEntry(writer, 'images/manifest.json', JSON.stringify({ version: 1, images: imagesManifest }, null, 2));
      }
    } catch (err) {
      console.warn('Failed to export images:', err);
    }
  }

  await writer.write(new Uint8Array(1024));
}

/**
 * Import all data from an archive (TAR preferred, ZIP for legacy)
 */
export async function importAllData(file: File): Promise<ImportResult> {
  try {
    const buffer = await file.arrayBuffer();
    const archive = await loadTarArchive(buffer);

    const results: ImportResult = {
      chatsImported: 0,
      settingsImported: false,
      imagesImported: 0,
      errors: []
    };

    // Import settings first
    try {
      const settingsText = await archive.getText('settings.json');
      if (settingsText) {
        const settingsData = JSON.parse(settingsText) as { settings?: Settings };
        if (settingsData.settings) {
          const currentSettings = loadSettings();
          const merged = {
            ...settingsData.settings,
            selectedConnectionId: currentSettings.selectedConnectionId || settingsData.settings.selectedConnectionId,
            selectedPresetId: currentSettings.selectedPresetId || settingsData.settings.selectedPresetId
          };
          saveSettings(merged);
          results.settingsImported = true;
        }
      }
    } catch (err) {
      console.error('Failed to import settings:', err);
      results.errors.push(`Settings: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Import images
    try {
      const manifestText = await archive.getText('images/manifest.json');
      if (manifestText) {
        const manifestData = JSON.parse(manifestText) as { images?: ImageManifestEntry[] };

        if (manifestData.images && Array.isArray(manifestData.images)) {
          for (const imageInfo of manifestData.images) {
            try {
              const base64Data = await archive.getBase64(`images/${imageInfo.filename}`);
              if (base64Data) {
                // Normalize to fix any doubled data URL prefixes, store just the base64
                const normalizedData = normalizeBase64Data(base64Data);
                await storeImage(imageInfo.id, normalizedData, imageInfo.mimeType || '', imageInfo.name || '');
                results.imagesImported++;
              }
            } catch (err) {
              console.error(`Failed to import image ${imageInfo.id}:`, err);
              results.errors.push(`Image ${imageInfo.id}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to import images:', err);
      results.errors.push(`Images: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Import chats
    try {
      const imported = await importChatsFromArchive(archive);
      results.chatsImported += imported.count;
      results.errors.push(...imported.errors);
    } catch (err) {
      console.error('Failed to import chats:', err);
      results.errors.push(`Chats: ${err instanceof Error ? err.message : String(err)}`);
    }

    return results;
  } catch (err) {
    console.error('Failed to import all data:', err);
    throw err;
  }
}

async function importChatsFromArchive(archive: TarArchive): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  let chatFilePaths: string[] = [];

  chatFilePaths = archive.list('chats/')
    .filter((path) => path.toLowerCase().endsWith('.json'))
    .filter((path) => normalizePath(path).toLowerCase() !== 'chats/manifest.json');

  if (chatFilePaths.length > 0) {
    // Try to read manifest for ordering
    let manifestEntries: ChatManifestEntry[] = [];
    try {
      const manifestText = await archive.getText('chats/manifest.json');
      if (manifestText) {
        const manifestData = JSON.parse(manifestText) as { chats?: ChatManifestEntry[] };
        if (Array.isArray(manifestData.chats)) {
          manifestEntries = manifestData.chats;
        }
      }
    } catch {
      // Manifest not found or invalid, will fall back to alphabetical order
    }

    // Create a map from path to manifest entry for ordering and metadata
    const pathToManifest = new Map<string, ChatManifestEntry>();
    for (const entry of manifestEntries) {
      pathToManifest.set(normalizePath(entry.path), entry);
    }

    // Sort by manifest order if available, otherwise alphabetically
    chatFilePaths.sort((a, b) => {
      const entryA = pathToManifest.get(normalizePath(a));
      const entryB = pathToManifest.get(normalizePath(b));
      if (entryA?.order !== undefined && entryB?.order !== undefined) {
        return entryA.order - entryB.order;
      }
      return a.localeCompare(b);
    });

    for (const path of chatFilePaths) {
      try {
        const chatText = await archive.getText(path);
        if (!chatText) {
          throw new Error('Missing chat file contents');
        }

        const parsed = JSON.parse(chatText) as ExportedChat | Chat;
        const chat = extractChatFromPayload(parsed);

        // Get manifest entry for this chat to preserve updatedAt
        const manifestEntry = pathToManifest.get(normalizePath(path));

        await createChat({
          nodes: chat.nodes,
          rootId: chat.rootId,
          settings: chat.settings,
          presetId: chat.presetId || undefined,
          // Preserve original updatedAt and title from manifest or chat data
          updatedAt: manifestEntry?.updatedAt || chat.updatedAt,
          title: chat.title || undefined
        });
        count++;
      } catch (err) {
        console.error(`Failed to import chat from ${path}:`, err);
        errors.push(`Chat file "${path}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { count, errors };
  }

  // Fallback to legacy chats.json
  const chatsText = await archive.getText('chats.json');
  if (!chatsText) {
    return { count, errors };
  }

  try {
    const chatsData = JSON.parse(chatsText) as { chats?: Chat[] };

    if (Array.isArray(chatsData?.chats)) {
      // Sort by updatedAt descending to preserve ordering
      const sortedChats = chatsData.chats.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      for (const chat of sortedChats) {
        try {
          await createChat({
            nodes: chat.nodes,
            rootId: chat.rootId,
            settings: chat.settings,
            presetId: chat.presetId || undefined,
            // Preserve original updatedAt and title
            updatedAt: chat.updatedAt,
            title: chat.title || undefined
          });
          count++;
        } catch (err) {
          console.error(`Failed to import chat ${chat.id}:`, err);
          errors.push(`Chat "${chat.title || 'untitled'}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } catch (err) {
    console.error('Failed to parse legacy chats.json:', err);
    errors.push(`Legacy chats.json: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { count, errors };
}

/**
 * Helper: Download a file with a given URL and filename
 */
function downloadFile(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Helper: Sanitize a string for use in filenames
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-z0-9_\-]/gi, '_')
    .replace(/_+/g, '_')
    .substring(0, 50);
}

function buildChatArchivePath(chat: Pick<Chat, 'id' | 'title'>, index: number, usedPaths: Set<string>): string {
  const safeTitle = sanitizeFilename(chat?.title || '');
  const safeId = sanitizeFilename(chat?.id || '');

  const baseParts = [safeTitle, safeId].filter(Boolean);
  const fallback = `chat_${index + 1}`;
  const baseName = (baseParts.length > 0 ? baseParts.join('_') : fallback).substring(0, 95);

  let candidate = `chats/${baseName || fallback}.json`;
  let suffix = 1;

  while (usedPaths.has(candidate)) {
    candidate = `chats/${baseName || fallback}_${suffix}.json`;
    suffix++;
  }

  usedPaths.add(candidate);
  return candidate;
}

function extractChatFromPayload(payload: unknown): Chat {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid chat payload');
  }

  const payloadObj = payload as Record<string, unknown>;
  const chat = (payloadObj.chat && typeof payloadObj.chat === 'object') 
    ? payloadObj.chat as Chat 
    : payload as Chat;

  if (!chat || typeof chat !== 'object') {
    throw new Error('Chat data missing');
  }

  if (!Array.isArray(chat.nodes)) {
    throw new Error('Chat data missing nodes');
  }

  if (chat.rootId == null) {
    if (chat.nodes.length > 0) {
      throw new Error('Chat data missing required fields');
    }
    return chat;
  }

  if (!Number.isFinite(Number(chat.rootId))) {
    throw new Error('Chat rootId must be numeric or null');
  }

  return chat;
}

/**
 * Helper: Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string | undefined): string {
  if (!mimeType) return 'dat';
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg'
  };
  return map[mimeType.toLowerCase()] || 'dat';
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const TAR_BLOCK_SIZE = 512;

function canStreamDownload(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

function encodedLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

function tarEntrySize(contentSize: number): number {
  return TAR_BLOCK_SIZE + Math.ceil(contentSize / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
}

function normalizePath(path: string): string {
  return path.replace(/^[./]+/, '');
}

function encodeText(text: string): Uint8Array {
  return textEncoder.encode(String(text ?? ''));
}

function decodeText(bytes: Uint8Array | null): string {
  if (!bytes) return '';
  return textDecoder.decode(bytes);
}

async function writeTarTextEntry(writer: FileSystemWriteStream, path: string, text: string): Promise<void> {
  await writeTarBytesEntry(writer, path, encodeText(text));
}

async function writeTarBytesEntry(writer: FileSystemWriteStream, path: string, bytes: Uint8Array): Promise<void> {
  await writer.write(createTarHeader(path, bytes.byteLength));
  await writer.write(bytes);
  const paddingSize = (TAR_BLOCK_SIZE - (bytes.byteLength % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
  if (paddingSize > 0) {
    await writer.write(new Uint8Array(paddingSize));
  }
}

function createTarHeader(path: string, size: number): Uint8Array {
  const header = new Uint8Array(TAR_BLOCK_SIZE);
  const normalized = normalizePath(path);
  const { name, prefix } = splitTarPath(normalized);

  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarNumeric(header, 124, 12, size);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  for (let i = 148; i < 156; i++) header[i] = 32;
  header[156] = '0'.charCodeAt(0);
  writeTarString(header, 257, 6, 'ustar');
  writeTarString(header, 263, 2, '00');
  writeTarString(header, 345, 155, prefix);

  let checksum = 0;
  for (let i = 0; i < header.length; i++) {
    checksum += header[i]!;
  }
  // Checksum uses the traditional "%06o\0 " format (6 digits, NUL, space)
  writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);

  return header;
}

function splitTarPath(path: string): { name: string; prefix: string } {
  const pathBytes = encodeText(path);
  if (pathBytes.byteLength <= 100) {
    return { name: path, prefix: '' };
  }

  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    const name = parts.slice(i).join('/');
    if (encodeText(prefix).byteLength <= 155 && encodeText(name).byteLength <= 100) {
      return { name, prefix };
    }
  }

  throw new Error(`Archive path is too long: ${path}`);
}

function writeTarString(header: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encodeText(value);
  if (bytes.byteLength > length) {
    throw new Error(`TAR field is too long: ${value}`);
  }
  header.set(bytes, offset);
}

function writeTarOctal(header: Uint8Array, offset: number, length: number, value: number): void {
  const text = value.toString(8);
  if (text.length > length - 1) {
    throw new Error(`TAR octal field overflow: value ${value} does not fit in ${length - 1} octal digits`);
  }
  // Standard tar octal fields: (length - 1) digits followed by a NUL terminator.
  writeTarString(header, offset, length, `${text.padStart(length - 1, '0')}\0`);
}

/**
 * Write a numeric field (e.g. size), falling back to GNU base-256 encoding
 * when the value does not fit in the octal representation (files >= 8 GB).
 */
function writeTarNumeric(header: Uint8Array, offset: number, length: number, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`TAR numeric field invalid: ${value}`);
  }

  const maxOctal = Math.pow(8, length - 1) - 1;
  if (value <= maxOctal) {
    writeTarOctal(header, offset, length, value);
    return;
  }

  // GNU base-256 (binary) encoding: high bit of the first byte set,
  // remaining bytes hold the big-endian value.
  let remaining = value;
  for (let i = length - 1; i > 0; i--) {
    header[offset + i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  if (remaining > 0x7f) {
    throw new Error(`TAR numeric field overflow: value ${value} does not fit in ${length} bytes`);
  }
  header[offset] = 0x80 | remaining;
}

function base64ToBytes(base64: string): Uint8Array {
  const binString = atob(base64);
  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binString = '';
  for (let i = 0; i < bytes.length; i++) {
    binString += String.fromCharCode(bytes[i]!);
  }
  return btoa(binString);
}

/**
 * Check if bytes look like base64 text (for backwards compatibility with old exports)
 */
function looksLikeBase64Text(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  // Base64 chars: A-Z (65-90), a-z (97-122), 0-9 (48-57), + (43), / (47), = (61)
  // Also allow whitespace which might be present
  const len = Math.min(bytes.length, 100);
  for (let i = 0; i < len; i++) {
    const b = bytes[i]!;
    const isBase64Char = (b >= 65 && b <= 90) || (b >= 97 && b <= 122) ||
                         (b >= 48 && b <= 57) || b === 43 || b === 47 || b === 61 ||
                         b === 10 || b === 13 || b === 32; // newline, carriage return, space
    if (!isBase64Char) return false;
  }
  return true;
}

/**
 * Extract just the base64 data from a potentially doubled/prefixed data URL
 */
function normalizeBase64Data(data: string): string {
  if (!data) return data;

  // Keep stripping data URL prefixes until we get just base64
  let result = data;
  let iterations = 0;
  while (result.includes('data:') && iterations < 5) {
    const commaIndex = result.indexOf(',');
    if (commaIndex !== -1) {
      result = result.slice(commaIndex + 1);
    } else {
      break;
    }
    iterations++;
  }

  return result;
}

interface UntarFile {
  name: string;
  buffer: ArrayBuffer | { buffer?: ArrayBuffer };
}

async function loadTarArchive(buffer: ArrayBuffer): Promise<TarArchive> {
  const files = await untar(buffer) as UntarFile[];
  const entryMap = new Map<string, Uint8Array>();

  for (const file of files) {
    const fileBuffer = file.buffer instanceof ArrayBuffer 
      ? file.buffer 
      : ((file.buffer as { buffer?: ArrayBuffer })?.buffer || new ArrayBuffer(0));
    const bytes = new Uint8Array(fileBuffer);
    entryMap.set(normalizePath(file.name), bytes);
  }

  return {
    list(prefix: string = ''): string[] {
      const normalizedPrefix = prefix ? normalizePath(prefix) : '';
      const needsSlash = normalizedPrefix && !normalizedPrefix.endsWith('/') && !normalizedPrefix.includes('.');
      const matchPrefix = needsSlash ? `${normalizedPrefix}/` : normalizedPrefix;
      const entries = Array.from(entryMap.keys());

      if (!matchPrefix) {
        return entries.slice();
      }

      return entries.filter((name) => {
        if (name === matchPrefix) return true;
        if (matchPrefix.endsWith('/')) {
          return name.startsWith(matchPrefix);
        }
        return name === matchPrefix || name.startsWith(`${matchPrefix}/`);
      });
    },
    async getText(path: string): Promise<string | null> {
      const entry = entryMap.get(normalizePath(path));
      if (!entry) return null;
      return decodeText(entry);
    },
    async getBase64(path: string): Promise<string | null> {
      const entry = entryMap.get(normalizePath(path));
      if (!entry) return null;
      // Check if it's old text format (base64 stored as text) or new binary format
      if (looksLikeBase64Text(entry)) {
        // Old format: already base64 text, just decode as text
        return decodeText(entry);
      }
      // New format: binary image data, convert to base64
      return bytesToBase64(entry);
    }
  };
}

/**
 * Fix all images in the database that have doubled data URL prefixes
 * Returns the number of images that were fixed
 */
export async function fixDoubledImages(): Promise<number> {
  try {
    const images = await getAllImages();
    let fixedCount = 0;

    for (const image of images) {
      if (image.data && image.id) {
        const normalized = normalizeBase64Data(image.data);
        if (normalized !== image.data) {
          await storeImage(image.id, normalized, image.mimeType || '', image.name || '');
          fixedCount++;
        }
      }
    }

    return fixedCount;
  } catch (err) {
    console.error('Failed to fix doubled images:', err);
    return 0;
  }
}
