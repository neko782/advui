// Chat persistence with signature tracking
import { saveChatContent } from '../../chatsStore.js';
import { sanitizeGraphComprehensive } from './graphValidation.js';
import { ensureUniqueIds } from './chatInit.js';
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

/**
 * Computes a content-aware signature for persistence change detection.
 * Uses actual content hashes instead of just lengths to detect same-length edits.
 */
export function computePersistSig(nodes: ChatNode[], chatSettings: ChatSettings, rootId: number | null): string {
  try {
    const mini = (nodes || []).map(n => {
      const variants = Array.isArray(n?.variants) ? n.variants : [];
      const activeIdx = Math.max(0, Math.min(variants.length - 1, Number(n?.active) || 0));
      const v = variants[activeIdx];
      // Include content hash instead of just length
      const contentHash = typeof v?.content === 'string' ? hashString(v.content) : 0;
      // Include variant count and active index for branch changes
      return `${n.id}|${v?.role || ''}|${contentHash}|${v?.next ?? 'null'}|${variants.length}|${activeIdx}`;
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
        // Image Generation settings
        imageGenerationEnabled: !!chatSettings?.imageGenerationEnabled,
        imageGenerationModel: chatSettings?.imageGenerationModel || '',
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
  try {
    if (!chatId || !mounted) return { updated: null, notice: '' };

    // Comprehensive sanitization: fix active indices, rootId, and multiple parents
    const sanitizeResult = sanitizeGraphComprehensive(nodes, rootId, debug);
    const { nodes: sanitized, notice, mutations } = sanitizeResult;
    
    // Use the corrected rootId if it was fixed
    const finalRootId = mutations.rootIdCorrected ? 
      (sanitized.length > 0 ? sanitized[0]?.id ?? null : null) : 
      rootId;
    
    const cleanedNodes = stripImageDataFromNodes(sanitized);

    // Persist full graph
    const updated = await saveChatContent(chatId, {
      nodes: cleanedNodes,
      settings: chatSettings,
      rootId: finalRootId
    });

    return { updated, notice, nodes: cleanedNodes };
  } catch (err) {
    return { updated: null, notice: '', nodes };
  }
}

