// Chat persistence with signature tracking
import { saveChatContent } from '../../chatsStore.js';
import { sanitizeGraphComprehensive } from './graphValidation.js';
import type { ChatNode, ChatSettings, Chat, PersistenceResult, ImageReference } from '../../types/index.js';

function sanitizeImages(images: unknown, stripData: boolean = false): ImageReference[] {
  if (!Array.isArray(images)) return [];
  const map = new Map<string, ImageReference & { data?: string }>();
  for (const entry of images) {
    if (entry == null) continue;
    let id: string | null = null;
    let mimeType: string | undefined;
    let name: string | undefined;
    let data: string | undefined;
    if (typeof entry === 'string') {
      id = entry.trim();
      if (!id) continue;
    } else if (typeof entry === 'object') {
      const entryObj = entry as Record<string, unknown>;
      id = typeof entryObj.id === 'string' && (entryObj.id as string).trim() ? (entryObj.id as string).trim() : null;
      if (!id) continue;
      if (typeof entryObj.mimeType === 'string' && (entryObj.mimeType as string).trim()) mimeType = (entryObj.mimeType as string).trim();
      if (typeof entryObj.name === 'string' && (entryObj.name as string).trim()) name = (entryObj.name as string).trim();
      if (!stripData && typeof entryObj.data === 'string' && entryObj.data) data = entryObj.data as string;
    } else {
      continue;
    }

    const existing = map.get(id);
    if (existing) {
      if (!existing.mimeType && mimeType) existing.mimeType = mimeType;
      if (!existing.name && name) existing.name = name;
      if (!(existing as { data?: string }).data && data) (existing as { data?: string }).data = data;
      continue;
    }

    const img: ImageReference & { data?: string } = { id };
    if (mimeType) img.mimeType = mimeType;
    if (name) img.name = name;
    if (!stripData && data) img.data = data;
    map.set(id, img);
  }
  return [...map.values()];
}

interface SanitizeResult {
  variant: unknown;
  changed: boolean;
}

function sanitizeVariantImages(variant: unknown): SanitizeResult {
  if (!variant || typeof variant !== 'object') return { variant, changed: false };
  const variantObj = variant as Record<string, unknown>;
  const imagesInput = variantObj.images;
  const normalized = sanitizeImages(imagesInput, true);
  const hasImages = normalized.length > 0;

  if (!Array.isArray(imagesInput)) {
    if (!hasImages && !('images' in variantObj)) return { variant, changed: false };
    const cleaned = { ...variantObj };
    if (hasImages) {
      cleaned.images = normalized;
    } else {
      delete cleaned.images;
    }
    return { variant: cleaned, changed: true };
  }

  const originalImages = imagesInput;

  if (!hasImages) {
    if (!originalImages.length) return { variant, changed: false };
    const cleaned = { ...variantObj };
    delete cleaned.images;
    return { variant: cleaned, changed: true };
  }

  let needsUpdate = originalImages.length !== normalized.length;
  if (!needsUpdate) {
    for (let i = 0; i < normalized.length; i++) {
      const orig = originalImages[i];
      const norm = normalized[i]!;
      const origId = typeof orig === 'string' ? orig.trim() : (orig && typeof orig === 'object' && typeof (orig as Record<string, unknown>).id === 'string' ? (orig as Record<string, unknown>).id as string : null);
      const origMime = (orig && typeof orig === 'object' && typeof (orig as Record<string, unknown>).mimeType === 'string') ? ((orig as Record<string, unknown>).mimeType as string).trim() : '';
      const origName = (orig && typeof orig === 'object' && typeof (orig as Record<string, unknown>).name === 'string') ? ((orig as Record<string, unknown>).name as string).trim() : '';
      const origHasData = !!(orig && typeof orig === 'object' && typeof (orig as Record<string, unknown>).data === 'string' && (orig as Record<string, unknown>).data);
      if (origId !== norm.id || origMime !== (norm.mimeType || '') || origName !== (norm.name || '') || origHasData) {
        needsUpdate = true;
        break;
      }
    }
  }

  if (!needsUpdate) return { variant, changed: false };
  return { variant: { ...variantObj, images: normalized }, changed: true };
}

function stripImageDataFromNodes(nodes: ChatNode[]): ChatNode[] {
  const list = Array.isArray(nodes) ? nodes : [];
  let mutated = false;
  const sanitizedNodes = list.map((node) => {
    if (!node || typeof node !== 'object') return node;
    const variants = Array.isArray(node.variants) ? node.variants : [];
    let variantsChanged = false;
    const sanitizedVariants = variants.map(variant => {
      const { variant: sanitized, changed } = sanitizeVariantImages(variant);
      if (changed) variantsChanged = true;
      return sanitized;
    });
    if (!variantsChanged) return node;
    mutated = true;
    return { ...node, variants: sanitizedVariants } as ChatNode;
  });
  return mutated ? sanitizedNodes : nodes;
}

/**
 * Simple hash function for strings (djb2 algorithm)
 * Provides fast, deterministic hashing for content comparison
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

function mixHash(hash: number, value: number): number {
  return ((hash << 5) + hash) ^ value;
}

function hashMaybeString(value: unknown): number {
  return typeof value === 'string' && value ? hashString(value) : 0;
}

function hashImages(images: unknown): number {
  const normalized = sanitizeImages(images, true);
  let hash = 5381;
  for (const img of normalized) {
    hash = mixHash(hash, hashString(`${img.id}|${img.mimeType || ''}|${img.name || ''}`));
  }
  return hash >>> 0;
}

function hashGeneratedImages(images: unknown): number {
  const list = Array.isArray(images) ? images : [];
  let hash = 5381;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : '';
    const dataLen = typeof obj.data === 'string' ? obj.data.length : 0;
    const revisedPromptHash = typeof obj.revisedPrompt === 'string' ? hashString(obj.revisedPrompt) : 0;
    hash = mixHash(hash, hashString(id));
    hash = mixHash(hash, dataLen);
    hash = mixHash(hash, revisedPromptHash);
  }
  return hash >>> 0;
}

function hashMcpItems(items: unknown): number {
  const list = Array.isArray(items) ? items : [];
  let hash = 5381;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    hash = mixHash(hash, hashMaybeString(obj.type));
    hash = mixHash(hash, hashMaybeString(obj.id));
    hash = mixHash(hash, hashMaybeString(obj.serverLabel));
    hash = mixHash(hash, hashMaybeString(obj.name));
    hash = mixHash(hash, hashMaybeString(obj.arguments));
    hash = mixHash(hash, hashMaybeString(obj.output));
    hash = mixHash(hash, hashMaybeString(obj.error));
    hash = mixHash(hash, hashMaybeString(obj.status));
    if (Array.isArray(obj.tools)) {
      for (const tool of obj.tools as Array<Record<string, unknown>>) {
        hash = mixHash(hash, hashString(`${typeof tool?.name === 'string' ? tool.name : ''}|${typeof tool?.description === 'string' ? tool.description : ''}`));
      }
    }
  }
  return hash >>> 0;
}

function hashVariant(variant: unknown): number {
  if (!variant || typeof variant !== 'object') return 0;
  const v = variant as Record<string, unknown>;
  let hash = 5381;
  hash = mixHash(hash, Number(v.id) || 0);
  hash = mixHash(hash, hashMaybeString(v.role));
  hash = mixHash(hash, hashMaybeString(v.content));
  hash = mixHash(hash, v.next == null ? 0 : (Number(v.next) || 0));
  hash = mixHash(hash, v.typing === true ? 1 : 0);
  hash = mixHash(hash, hashMaybeString(v.error));
  hash = mixHash(hash, hashMaybeString(v.reasoningSummary));
  hash = mixHash(hash, v.reasoningSummaryLoading === true ? 1 : 0);
  hash = mixHash(hash, hashImages(v.images));
  hash = mixHash(hash, hashGeneratedImages(v.generatedImages));
  hash = mixHash(hash, hashMcpItems(v.mcpItems));
  return hash >>> 0;
}

/**
 * Computes a content-aware signature for persistence change detection.
 * Uses actual content hashes instead of just lengths to detect same-length edits.
 */
export function computePersistSig(nodes: ChatNode[], chatSettings: ChatSettings, rootId: number | null): string {
  try {
    const list = Array.isArray(nodes) ? nodes : [];
    const mini = list
      .slice()
      .sort((a, b) => (Number(a?.id) || 0) - (Number(b?.id) || 0))
      .map(n => {
        const variants = Array.isArray(n?.variants) ? n.variants : [];
        const activeIdx = Math.max(0, Math.min(variants.length - 1, Number(n?.active) || 0));
        let nodeHash = 5381;
        for (const v of variants) {
          nodeHash = mixHash(nodeHash, hashVariant(v));
        }
        nodeHash = mixHash(nodeHash, activeIdx);
        nodeHash = mixHash(nodeHash, variants.length);
        return `${n.id}|${activeIdx}|${variants.length}|${(nodeHash >>> 0)}`;
      });
    return JSON.stringify({
      m: mini,
      settings: {
        model: chatSettings?.model || '',
        streaming: !!chatSettings?.streaming,
        presetId: chatSettings?.presetId || '',
        maxOutputTokens: chatSettings?.maxOutputTokens ?? null,
        topP: chatSettings?.topP ?? null,
        temperature: chatSettings?.temperature ?? null,
        reasoningEffort: chatSettings?.reasoningEffort || '',
        textVerbosity: chatSettings?.textVerbosity || '',
        reasoningSummary: chatSettings?.reasoningSummary || '',
        thinkingEnabled: !!chatSettings?.thinkingEnabled,
        thinkingBudgetTokens: chatSettings?.thinkingBudgetTokens ?? null,
        connectionId: chatSettings?.connectionId || '',
        // Web Search settings
        webSearchEnabled: !!chatSettings?.webSearchEnabled,
        webSearchDomains: chatSettings?.webSearchDomains || '',
        webSearchCountry: chatSettings?.webSearchCountry || '',
        webSearchCity: chatSettings?.webSearchCity || '',
        webSearchRegion: chatSettings?.webSearchRegion || '',
        webSearchTimezone: chatSettings?.webSearchTimezone || '',
        webSearchCacheOnly: !!chatSettings?.webSearchCacheOnly,
        // Code Interpreter settings
        codeInterpreterEnabled: !!chatSettings?.codeInterpreterEnabled,
        // Shell settings
        shellEnabled: !!chatSettings?.shellEnabled,
        // Image Generation settings
        imageGenerationEnabled: !!chatSettings?.imageGenerationEnabled,
        imageGenerationModel: chatSettings?.imageGenerationModel || '',
        // MCP settings
        mcpServers: JSON.stringify(Array.isArray(chatSettings?.mcpServers) ? chatSettings.mcpServers : []),
      },
      rootId,
    });
  } catch {
    return '';
  }
}

export async function persistChatContent(
  chatId: string,
  nodes: ChatNode[],
  chatSettings: ChatSettings,
  rootId: number | null,
  debug: boolean,
  mounted: boolean
): Promise<PersistenceResult> {
  if (!chatId || !mounted) return { updated: null, notice: '', nodes, rootId };

  try {
    // Comprehensive sanitization: fix active indices, rootId, and multiple parents
    const sanitizeResult = sanitizeGraphComprehensive(nodes, rootId, debug);
    const { nodes: sanitized, rootId: sanitizedRootId, notice } = sanitizeResult;

    const cleanedNodes = stripImageDataFromNodes(sanitized);

    // Persist full graph
    const updated = await saveChatContent(chatId, {
      nodes: cleanedNodes,
      settings: chatSettings,
      rootId: sanitizedRootId
    });

    const finalNodes = (updated && Array.isArray(updated.nodes)) ? updated.nodes : cleanedNodes;
    const finalRootId = updated ? updated.rootId : sanitizedRootId;

    return { updated, notice, nodes: finalNodes, rootId: finalRootId };
  } catch (err) {
    throw err;
  }
}
