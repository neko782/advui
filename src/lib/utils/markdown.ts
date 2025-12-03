import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type Renderer from 'markdown-it/lib/renderer.mjs';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';

// markdown-it instance configured for our chat bubbles
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: true });
md.disable('code'); // disallow indented code blocks; require fenced blocks

const defaultRenderLink = md.renderer.rules.link_open || function(
  tokens: Token[],
  idx: number,
  options: MarkdownIt.Options,
  _env: unknown,
  self: Renderer
): string {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.link_open = function(
  tokens: Token[],
  idx: number,
  options: MarkdownIt.Options,
  env: unknown,
  self: Renderer
): string {
  const a = tokens[idx];
  if (a) {
    const targetIndex = a.attrIndex('target');
    if (targetIndex < 0) {
      a.attrPush(['target', '_blank']);
    } else if (a.attrs) {
      a.attrs[targetIndex]![1] = '_blank';
    }
    const relIndex = a.attrIndex('rel');
    if (relIndex < 0) {
      a.attrPush(['rel', 'noopener noreferrer']);
    } else if (a.attrs) {
      a.attrs[relIndex]![1] = 'noopener noreferrer';
    }
  }
  return defaultRenderLink(tokens, idx, options, env, self);
};

// LRU cache for rendered markdown (max 200 entries to avoid memory bloat)
const cache = new Map<string, string>();
const MAX_CACHE_SIZE = 200;

export function renderMarkdown(src: string): string {
  const key = String(src || '');

  // Return cached result if available
  if (cache.has(key)) {
    const cached = cache.get(key)!;
    // Move to end (LRU)
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  // Render and cache
  const result = md.render(key);
  cache.set(key, result);

  // Evict oldest entry if cache is full
  if (cache.size > MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }

  return result;
}

