// Chat image/attachment manager (Svelte 5 runes class).
// Owns composer attachments and the in-memory image cache; handles media
// storage, cache hydration, node sanitization (refs only persisted) and
// re-enrichment of nodes with cached data for API requests.

import { storeImage, generateImageId, fileToBase64, getImage } from '../imageStore.js';
import { isSupportedAttachment, inferMimeType } from '../attachments/mime.js';
import type { Image, ImageRef, ChatNode, VisibleMessage, GenerationResponse } from '../types/index.js';

export interface ImageCacheEntry {
  data: string;
  mimeType?: string;
  name?: string;
}

type GeneratedImageRef = ImageRef & { revisedPrompt?: string };

export function toImageRef(img: unknown): ImageRef | null {
  if (!img || typeof img !== 'object') return null;
  const obj = img as Record<string, unknown>;
  const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : null;
  if (!id) return null;
  const ref: ImageRef = { id };
  if (typeof obj.mimeType === 'string' && obj.mimeType.trim()) ref.mimeType = obj.mimeType.trim();
  if (typeof obj.name === 'string' && obj.name.trim()) ref.name = obj.name.trim();
  return ref;
}

export function buildImageRefs(list: unknown): ImageRef[] {
  if (!Array.isArray(list)) return [];
  const refs: ImageRef[] = [];
  const seen = new Set<string>();
  for (const img of list) {
    const ref = toImageRef(img);
    if (!ref || seen.has(ref.id)) continue;
    seen.add(ref.id);
    refs.push(ref);
  }
  return refs;
}

export function generatedImageName(image: { id?: string } | null | undefined): string {
  const id = typeof image?.id === 'string' && image.id.trim() ? image.id.trim() : `generated-${Date.now()}`;
  return `${id}.png`;
}

export function buildGeneratedImageRefs(list: unknown): GeneratedImageRef[] {
  if (!Array.isArray(list)) return [];
  const refs: GeneratedImageRef[] = [];
  const seen = new Set<string>();
  for (const img of list) {
    if (!img || typeof img !== 'object') continue;
    const obj = img as Record<string, unknown>;
    const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ref: GeneratedImageRef = { id };
    if (typeof obj.mimeType === 'string' && obj.mimeType.trim()) ref.mimeType = obj.mimeType.trim();
    else ref.mimeType = 'image/png';
    if (typeof obj.name === 'string' && obj.name.trim()) ref.name = obj.name.trim();
    else ref.name = generatedImageName({ ...(obj as object), id });
    if (typeof obj.revisedPrompt === 'string' && obj.revisedPrompt) ref.revisedPrompt = obj.revisedPrompt;
    refs.push(ref);
  }
  return refs;
}

export class ChatImageManager {
  attachedImages = $state<Image[]>([]);
  imageCache = $state<Record<string, ImageCacheEntry>>({});
  private pendingImageLoads = new Set<string>();

  async handleFilesSelected(files: File[] | FileList | null): Promise<void> {
    try {
      const incoming = Array.isArray(files) ? files : [];
      const accepted = incoming.filter(isSupportedAttachment);
      if (!accepted.length) return;
      const imagePromises = accepted.map(async (file) => {
        const id = generateImageId();
        const base64 = await fileToBase64(file);
        const mimeType = inferMimeType(file) || file.type || '';
        await storeImage(id, base64, mimeType, file.name);
        const image: Image = {
          id,
          data: base64,
          mimeType: mimeType || undefined,
          name: file?.name || undefined,
        };
        this.cacheImageData(image);
        return image;
      });
      const images = await Promise.all(imagePromises);
      this.attachedImages = [...this.attachedImages, ...images];
    } catch (err) {
      console.error('Failed to attach images:', err);
    }
  }

  removeAttachedImage(id: string): void {
    this.attachedImages = this.attachedImages.filter(img => img.id !== id);
  }

  clearAttached(): void {
    this.attachedImages = [];
  }

  buildAttachedImageRefs(): ImageRef[] {
    return buildImageRefs(this.attachedImages);
  }

  cacheImageData(image: unknown): void {
    if (!image || typeof image !== 'object') return;
    const obj = image as Record<string, unknown>;
    const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : null;
    const data = typeof obj.data === 'string' && obj.data ? obj.data : null;
    if (!id || !data) return;
    const mimeType = typeof obj.mimeType === 'string' && obj.mimeType.trim() ? obj.mimeType.trim() : undefined;
    const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : undefined;
    const existing = this.imageCache[id] || {} as ImageCacheEntry;
    const next: ImageCacheEntry = {
      data,
      mimeType: mimeType || existing.mimeType,
      name: name || existing.name,
    };
    if (existing.data === next.data && existing.mimeType === next.mimeType && existing.name === next.name) return;
    this.imageCache = { ...this.imageCache, [id]: next };
  }

  /** Persists generated images to media storage and replaces data with refs. */
  async storeGeneratedImagesInMedia(reply: GenerationResponse): Promise<GenerationResponse> {
    if (!reply || typeof reply !== 'object' || !Array.isArray(reply.generatedImages)) return reply;
    const generatedImages: GeneratedImageRef[] = [];
    for (const image of reply.generatedImages) {
      if (!image || typeof image !== 'object') continue;
      const id = typeof image.id === 'string' && image.id.trim() ? image.id.trim() : generateImageId();
      const data = typeof image.data === 'string' && image.data ? image.data : '';
      const mimeType = typeof image.mimeType === 'string' && image.mimeType.trim() ? image.mimeType.trim() : 'image/png';
      const name = typeof image.name === 'string' && image.name.trim() ? image.name.trim() : generatedImageName({ ...image, id });
      const revisedPrompt = typeof image.revisedPrompt === 'string' && image.revisedPrompt ? image.revisedPrompt : undefined;

      if (data) {
        this.cacheImageData({ id, data, mimeType, name });
        try {
          await storeImage(id, data, mimeType, name);
        } catch (err) {
          console.warn('Failed to store generated image in media:', err);
        }
      }

      const ref: GeneratedImageRef = { id, mimeType, name };
      if (revisedPrompt) ref.revisedPrompt = revisedPrompt;
      generatedImages.push(ref);
    }
    return { ...reply, generatedImages: generatedImages.length ? generatedImages : undefined };
  }

  private async fetchImageRecord(meta: { id?: string; mimeType?: string; name?: string }): Promise<void> {
    const id = typeof meta?.id === 'string' && meta.id.trim() ? meta.id.trim() : null;
    if (!id) return;
    if (this.pendingImageLoads.has(id)) return;
    if (this.imageCache[id]?.data) return;
    if (typeof indexedDB === 'undefined') return;
    this.pendingImageLoads.add(id);
    try {
      const record = await getImage(id);
      if (record && typeof record.data === 'string' && record.data) {
        this.cacheImageData({
          id,
          data: record.data,
          mimeType: record.mimeType || meta?.mimeType,
          name: record.name || meta?.name,
        });
      }
    } catch { /* ignore */ }
    finally {
      this.pendingImageLoads.delete(id);
    }
  }

  ensureImagesAvailable(list: Array<{ id?: string; mimeType?: string; name?: string }>): void {
    if (!Array.isArray(list) || !list.length) return;
    const tasks: Promise<void>[] = [];
    for (const meta of list) {
      const id = typeof meta?.id === 'string' && meta.id.trim() ? meta.id.trim() : null;
      if (!id) continue;
      if (this.imageCache[id]?.data) continue;
      tasks.push(this.fetchImageRecord(meta));
    }
    if (tasks.length) Promise.allSettled(tasks).catch(() => {});
  }

  /** Hydrates the cache from visible messages and loads any missing media. */
  ensureVisibleImages(visible: VisibleMessage[]): void {
    const missing: Array<{ id: string; mimeType?: string; name?: string }> = [];
    const seen = new Set<string>();
    for (const vm of visible) {
      const imgs = Array.isArray(vm?.m?.images) ? vm.m.images : [];
      for (const img of imgs as unknown[]) {
        if (img == null) continue;
        if (typeof img === 'string') {
          const id = img.trim();
          if (!id || this.imageCache[id]?.data || seen.has(id)) continue;
          seen.add(id);
          missing.push({ id });
          continue;
        }
        if (typeof img !== 'object') continue;
        const obj = img as Record<string, unknown>;
        if (typeof obj.data === 'string' && obj.data) {
          this.cacheImageData(obj);
          continue;
        }
        const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : null;
        if (!id || this.imageCache[id]?.data || seen.has(id)) continue;
        seen.add(id);
        missing.push({ id, mimeType: obj.mimeType as string | undefined, name: obj.name as string | undefined });
      }
      const generatedImages = Array.isArray(vm?.m?.generatedImages) ? vm.m.generatedImages : [];
      for (const img of generatedImages as unknown[]) {
        if (!img || typeof img !== 'object') continue;
        const obj = img as Record<string, unknown>;
        if (typeof obj.data === 'string' && obj.data) {
          this.cacheImageData(obj);
          continue;
        }
        const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : null;
        if (!id || this.imageCache[id]?.data || seen.has(id)) continue;
        seen.add(id);
        missing.push({ id, mimeType: (obj.mimeType as string | undefined) || 'image/png', name: obj.name as string | undefined });
      }
    }
    if (missing.length) this.ensureImagesAvailable(missing);
  }

  /**
   * Replaces inline image data with refs on all variants, caching (and for
   * generated images, migrating to media storage) any inline data found.
   */
  sanitizeNodesImageData(nodesInput: ChatNode[]): ChatNode[] {
    if (!Array.isArray(nodesInput)) return nodesInput;
    let mutated = false;
    const sanitizedNodes = nodesInput.map(node => {
      if (!node || typeof node !== 'object') return node;
      const variants = Array.isArray(node.variants) ? node.variants : [];
      let variantsChanged = false;
      const sanitizedVariants = variants.map((variantInput) => {
        if (!variantInput || typeof variantInput !== 'object') return variantInput;
        const variant = variantInput as unknown as Record<string, unknown>;
        const refs = buildImageRefs(variant.images);
        const hasImages = refs.length > 0;
        const originalImages = Array.isArray(variant.images) ? variant.images : [];
        let needsUpdate = hasImages
          ? (originalImages.length !== refs.length)
          : originalImages.length > 0;
        if (!needsUpdate && hasImages) {
          for (let i = 0; i < refs.length; i++) {
            const orig = originalImages[i];
            const ref = refs[i]!;
            if (typeof orig === 'string') { needsUpdate = true; break; }
            if (!orig || typeof orig !== 'object') { needsUpdate = true; break; }
            const origMime = (typeof orig.mimeType === 'string' && orig.mimeType.trim()) || '';
            const origName = (typeof orig.name === 'string' && orig.name.trim()) || '';
            const refMime = ref.mimeType || '';
            const refName = ref.name || '';
            const hasData = typeof orig.data === 'string' && orig.data;
            if (orig.id !== ref.id || origMime !== refMime || origName !== refName || hasData) {
              needsUpdate = true;
              break;
            }
          }
        }
        for (const orig of originalImages) {
          if (orig && typeof orig === 'object' && typeof orig.data === 'string' && orig.data) {
            this.cacheImageData(orig);
          }
        }
        let nextVariant = variant;
        if (needsUpdate) {
          variantsChanged = true;
          if (hasImages) {
            nextVariant = { ...nextVariant, images: refs };
          } else {
            const cleaned = { ...nextVariant };
            delete cleaned.images;
            nextVariant = cleaned;
          }
        }

        const generatedRefs = buildGeneratedImageRefs(nextVariant.generatedImages);
        const originalGeneratedImages = Array.isArray(nextVariant.generatedImages) ? nextVariant.generatedImages : [];
        let generatedNeedsUpdate = generatedRefs.length
          ? originalGeneratedImages.length !== generatedRefs.length
          : originalGeneratedImages.length > 0;
        if (!generatedNeedsUpdate && generatedRefs.length) {
          for (let i = 0; i < generatedRefs.length; i++) {
            const orig = originalGeneratedImages[i];
            const ref = generatedRefs[i]!;
            if (!orig || typeof orig !== 'object') { generatedNeedsUpdate = true; break; }
            const origMime = (typeof orig.mimeType === 'string' && orig.mimeType.trim()) || '';
            const origName = (typeof orig.name === 'string' && orig.name.trim()) || '';
            const origPrompt = (typeof orig.revisedPrompt === 'string' && orig.revisedPrompt) || '';
            const hasData = typeof orig.data === 'string' && orig.data;
            if (orig.id !== ref.id || origMime !== (ref.mimeType || '') || origName !== (ref.name || '') || origPrompt !== (ref.revisedPrompt || '') || hasData) {
              generatedNeedsUpdate = true;
              break;
            }
          }
        }
        for (const orig of originalGeneratedImages) {
          if (orig && typeof orig === 'object' && typeof orig.data === 'string' && orig.data) {
            const id = typeof orig.id === 'string' && orig.id.trim() ? orig.id.trim() : null;
            if (!id) continue;
            const mimeType = typeof orig.mimeType === 'string' && orig.mimeType.trim() ? orig.mimeType.trim() : 'image/png';
            const name = typeof orig.name === 'string' && orig.name.trim() ? orig.name.trim() : generatedImageName({ ...orig, id });
            this.cacheImageData({ ...orig, id, mimeType, name });
            storeImage(id, orig.data, mimeType, name).catch((err) => {
              console.warn('Failed to migrate generated image to media:', err);
            });
          }
        }
        if (!generatedNeedsUpdate) return nextVariant;
        variantsChanged = true;
        if (generatedRefs.length) return { ...nextVariant, generatedImages: generatedRefs };
        const cleaned = { ...nextVariant };
        delete cleaned.generatedImages;
        return cleaned;
      });
      if (!variantsChanged) return node;
      mutated = true;
      return { ...node, variants: sanitizedVariants } as unknown as ChatNode;
    });
    return mutated ? sanitizedNodes : nodesInput;
  }

  /** Enriches image refs on nodes with cached data (for API requests). */
  withImageData(nodesInput: ChatNode[]): ChatNode[] {
    if (!Array.isArray(nodesInput)) return nodesInput;
    let mutated = false;
    const enrichedNodes = nodesInput.map(node => {
      if (!node || typeof node !== 'object') return node;
      const variants = Array.isArray(node.variants) ? node.variants : [];
      let variantsChanged = false;
      const enrichedVariants = variants.map((variantInput) => {
        if (!variantInput || typeof variantInput !== 'object') return variantInput;
        const variant = variantInput as unknown as Record<string, unknown>;
        const images = Array.isArray(variant.images) ? variant.images : [];
        if (!images.length) return variant;
        let changed = false;
        const enrichedImages = images.map((image: unknown) => {
          if (image == null) return image;
          if (typeof image === 'string') {
            const id = image.trim();
            if (!id) return image;
            const cached = this.imageCache[id];
            if (cached?.data) {
              changed = true;
              return {
                id,
                mimeType: cached.mimeType,
                name: cached.name,
                data: cached.data,
              };
            }
            return { id };
          }
          if (typeof image !== 'object') return image;
          const obj = image as Record<string, unknown>;
          if (typeof obj.data === 'string' && obj.data) return image;
          const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : null;
          if (!id) return image;
          const cached = this.imageCache[id];
          if (cached?.data) {
            changed = true;
            return {
              ...obj,
              data: cached.data,
              mimeType: obj.mimeType || cached.mimeType,
              name: obj.name ?? cached.name,
            };
          }
          return image;
        });
        if (!changed) return variant;
        variantsChanged = true;
        return { ...variant, images: enrichedImages };
      });
      if (!variantsChanged) return node;
      mutated = true;
      return { ...node, variants: enrichedVariants } as unknown as ChatNode;
    });
    return mutated ? enrichedNodes : nodesInput;
  }
}
