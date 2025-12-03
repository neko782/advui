// Utility functions for exporting and importing chat data
import type {
  Chat,
  ExportedChat,
  ImportResult,
  ChatManifestEntry,
  ImageManifestEntry,
  TarArchive,
  Settings,
  StoredImage
} from '../types/index.js';

import { getChats, getChat, createChat } from '../chatsStore.js';
import { loadSettings, saveSettings } from '../settingsStore.js';
import { getAllImages, storeImage } from '../imageStore.js';
import Tar from 'tar-js';
import untar from 'js-untar';

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
      presetId: chat.presetId
    });

    return result;
  } catch (err) {
    console.error('Failed to import chat:', err);
    throw err;
  }
}

/**
 * Export all data (chats, settings, images) as a TAR archive
 */
export async function exportAllData(): Promise<void> {
  try {
    const tar = new Tar();

    // Export all chats
    const chats = await getChats();
    const exportedAt = new Date().toISOString();
    const chatManifest: ChatManifestEntry[] = [];
    const usedChatPaths = new Set<string>();

    chats.forEach((chat, index) => {
      if (!chat) return;
      const filename = buildChatArchivePath(chat, index, usedChatPaths);

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
        path: filename
      });
    });

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

    // Export settings
    const settings = loadSettings();
    const settingsData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings
    };
    tar.append('settings.json', encodeText(JSON.stringify(settingsData, null, 2)));

    // Export images if indexedDB is available
    try {
      const images = await getAllImages();
      if (images && images.length > 0) {
        const imagesManifest: ImageManifestEntry[] = [];

        for (const image of images) {
          if (image.data && image.id) {
            const ext = getExtensionFromMimeType(image.mimeType) || 'dat';
            const filename = `${image.id}.${ext}`;
            const base64Data = image.data.split(',')[1] || image.data;

            tar.append(`images/${filename}`, encodeText(base64Data));

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

    const tarData = tar.out;
    const blob = new Blob([tarData], { type: 'application/x-tar' });
    const url = URL.createObjectURL(blob);

    const fileName = `advui_backup_${Date.now()}.tar`;
    downloadFile(url, fileName);

    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Failed to export all data:', err);
    throw err;
  }
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
                const dataUrl = `data:${imageInfo.mimeType || 'image/png'};base64,${base64Data}`;
                await storeImage(imageInfo.id, dataUrl, imageInfo.mimeType || '', imageInfo.name || '');
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
    chatFilePaths.sort();

    for (const path of chatFilePaths) {
      try {
        const chatText = await archive.getText(path);
        if (!chatText) {
          throw new Error('Missing chat file contents');
        }

        const parsed = JSON.parse(chatText) as ExportedChat | Chat;
        const chat = extractChatFromPayload(parsed);

        await createChat({
          nodes: chat.nodes,
          rootId: chat.rootId,
          settings: chat.settings,
          presetId: chat.presetId
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
      for (const chat of chatsData.chats) {
        try {
          await createChat({
            nodes: chat.nodes,
            rootId: chat.rootId,
            settings: chat.settings,
            presetId: chat.presetId
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

function buildChatArchivePath(chat: Chat, index: number, usedPaths: Set<string>): string {
  const safeTitle = sanitizeFilename(chat?.title || '');
  const safeId = sanitizeFilename(chat?.id || '');

  const baseParts = [safeTitle, safeId].filter(Boolean);
  const fallback = `chat_${index + 1}`;
  const baseName = baseParts.length > 0 ? baseParts.join('_') : fallback;

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

  if (chat.nodes == null) {
    throw new Error('Chat data missing nodes');
  }

  if (chat.rootId == null) {
    throw new Error('Chat data missing required fields');
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
      return decodeText(entry);
    }
  };
}

