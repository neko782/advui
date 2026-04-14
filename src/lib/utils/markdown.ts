import { Marked, type Token, type Tokens } from 'marked';
import hljs from 'highlight.js/lib/core';

// 25 most common languages
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import graphql from 'highlight.js/lib/languages/graphql';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import csharp from 'highlight.js/lib/languages/csharp';
import swift from 'highlight.js/lib/languages/swift';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import plaintext from 'highlight.js/lib/languages/plaintext';

// Register languages
const languages: Record<string, any> = {
  javascript, typescript, python, bash, shell, json, yaml, xml, css, sql,
  graphql, c, cpp, rust, go, java, kotlin, csharp, swift, ruby, php,
  dockerfile, markdown, diff, plaintext,
};
for (const [name, lang] of Object.entries(languages)) {
  hljs.registerLanguage(name, lang);
}

// Aliases
const aliases: Record<string, any> = {
  js: javascript, ts: typescript, jsx: javascript, tsx: typescript,
  py: python, sh: bash, zsh: bash,
  yml: yaml, html: xml, svg: xml, xhtml: xml,
  rs: rust, cs: csharp, rb: ruby,
  docker: dockerfile, md: markdown,
  text: plaintext, txt: plaintext,
};
for (const [alias, lang] of Object.entries(aliases)) {
  hljs.registerLanguage(alias, lang);
}

// Guardrail to avoid creating thousands of DOM nodes when code blocks are huge
const MAX_HIGHLIGHT_CHARS = 20000;
const MAX_HIGHLIGHT_LINES = 400;
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeLinkHref(href: unknown): string {
  if (typeof href !== 'string') return '#';
  const raw = href.trim();
  if (!raw) return '#';

  // Keep in-app anchors and relative links intact.
  if (
    raw.startsWith('#') ||
    raw.startsWith('/') ||
    raw.startsWith('./') ||
    raw.startsWith('../') ||
    raw.startsWith('?') ||
    raw.startsWith('//')
  ) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    if (SAFE_LINK_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
      return raw;
    }
  } catch {
    return '#';
  }

  return '#';
}

function normalizeLanguageClass(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return normalized || 'text';
}

interface HighlightedCodeBlock {
  codeHtml: string;
  langLabel: string;
  langClass: string;
}

function highlightCodeBlock(rawCode: string, specifiedLang = ''): HighlightedCodeBlock {
  const requestedLang = specifiedLang.trim();
  const skipHighlight = (
    rawCode.length > MAX_HIGHLIGHT_CHARS ||
    rawCode.split(/\r?\n/).length > MAX_HIGHLIGHT_LINES
  );

  let codeHtml = rawCode;
  let langLabel = requestedLang;

  if (!skipHighlight) {
    if (requestedLang && hljs.getLanguage(requestedLang)) {
      try {
        codeHtml = hljs.highlight(rawCode, { language: requestedLang, ignoreIllegals: true }).value;
      } catch {
        codeHtml = escapeHtml(rawCode);
      }
    } else if (!requestedLang) {
      try {
        const result = hljs.highlightAuto(rawCode);
        codeHtml = result.value;
        langLabel = result.language || 'text';
      } catch {
        codeHtml = escapeHtml(rawCode);
        langLabel = 'text';
      }
    } else {
      codeHtml = escapeHtml(rawCode);
    }
  } else {
    codeHtml = escapeHtml(rawCode);
  }

  if (!langLabel) {
    langLabel = 'text';
  }

  return {
    codeHtml,
    langLabel,
    langClass: normalizeLanguageClass(langLabel),
  };
}

function renderCodeBlockHtml(rawCode: string, specifiedLang = ''): string {
  const highlighted = highlightCodeBlock(rawCode, specifiedLang);

  return `<div class="code-block-wrapper">
<div class="code-block-header">
<span class="code-lang">${escapeHtml(highlighted.langLabel)}</span>
<button type="button" class="code-copy-btn" aria-label="Copy code">Copy</button>
</div>
<pre><code class="hljs language-${escapeHtml(highlighted.langClass)}">${highlighted.codeHtml}</code></pre>
</div>`;
}

// Custom renderer shared between instances
const customRenderer = {
  renderer: {
    code(token: { text?: string; lang?: string }) {
      const rawCode = typeof token.text === 'string' ? token.text : '';
      return renderCodeBlockHtml(rawCode, token.lang || '');
    },

    link(
      this: { parser?: { parseInline?: (tokens: unknown[]) => string } },
      token: { href?: string; title?: string; tokens?: unknown[]; text?: string }
    ) {
      const href = sanitizeLinkHref(token.href);
      const title = token.title;
      const text = token.tokens && this?.parser?.parseInline
        ? this.parser.parseInline(token.tokens)
        : (token.text || '');
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
};

// Flag checked by html renderer
let allowHtml = false;

const marked = new Marked({ breaks: true, gfm: true });
marked.use(customRenderer as any);
marked.use({
  renderer: {
    html(token) {
      return allowHtml ? token.raw : escapeHtml(token.raw);
    },
  },
  // Disable indented code blocks (only allow fenced ```)
  tokenizer: {
    code() { return undefined; },
  },
});

// LRU cache for rendered markdown (keyed by content + html setting)
const cache = new Map<string, string>();
const MAX_CACHE_SIZE = 200;
const MAX_CACHEABLE_CHARS = 12000;

export interface RenderMarkdownOptions {
  allowInlineHtml?: boolean;
  cache?: boolean;
}

export interface MarkdownTableCell {
  html: string;
  align: Tokens.TableCell['align'];
}

export interface MarkdownHtmlBlock {
  kind: 'html';
  key: string;
  html: string;
}

export interface MarkdownCodeBlock {
  kind: 'code';
  key: string;
  codeHtml: string;
  codeText: string;
  langLabel: string;
  langClass: string;
}

export interface MarkdownTableBlock {
  kind: 'table';
  key: string;
  header: MarkdownTableCell[];
  rows: MarkdownTableCell[][];
}

export type MarkdownBlock = MarkdownHtmlBlock | MarkdownCodeBlock | MarkdownTableBlock;

export interface BuildMarkdownBlocksOptions extends RenderMarkdownOptions {
  streaming?: boolean;
}

function withAllowHtml<T>(value: boolean, fn: () => T): T {
  const previous = allowHtml;
  allowHtml = value;
  try {
    return fn();
  } finally {
    allowHtml = previous;
  }
}

function renderTokens(tokens: Token[], allowInlineHtmlValue: boolean): string {
  return withAllowHtml(allowInlineHtmlValue, () => marked.parser(tokens) as string);
}

function renderInlineTokens(tokens: Token[], allowInlineHtmlValue: boolean): string {
  if (!tokens.length) {
    return '';
  }

  return withAllowHtml(
    allowInlineHtmlValue,
    () => marked.Parser.parseInline(tokens, marked.defaults)
  );
}

function isRenderableToken(token: Token): boolean {
  return token.type !== 'space' && token.type !== 'def';
}

function findLastRenderableTokenIndex(tokens: Token[]): number {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (isRenderableToken(tokens[i])) {
      return i;
    }
  }

  return -1;
}

export function buildMarkdownBlocks(src: string, options: BuildMarkdownBlocksOptions = {}): MarkdownBlock[] {
  const text = String(src || '');
  if (!text) {
    return [];
  }

  const tokens = marked.lexer(text);
  const lastRenderableIndex = options.streaming ? findLastRenderableTokenIndex(tokens) : -1;
  const blocks: MarkdownBlock[] = [];
  let renderableIndex = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!isRenderableToken(token)) {
      continue;
    }

    const key = `${renderableIndex}:${token.type}`;
    renderableIndex += 1;
    const allowBlockHtml = !!options.allowInlineHtml && i !== lastRenderableIndex;

    if (token.type === 'code') {
      const highlighted = highlightCodeBlock(token.text, token.lang || '');
      blocks.push({
        kind: 'code',
        key,
        codeHtml: highlighted.codeHtml,
        codeText: token.text,
        langLabel: highlighted.langLabel,
        langClass: highlighted.langClass,
      });
      continue;
    }

    if (token.type === 'table') {
      blocks.push({
        kind: 'table',
        key,
        header: token.header.map((cell) => ({
          html: renderInlineTokens(cell.tokens, allowBlockHtml),
          align: cell.align,
        })),
        rows: token.rows.map((row) => row.map((cell) => ({
          html: renderInlineTokens(cell.tokens, allowBlockHtml),
          align: cell.align,
        }))),
      });
      continue;
    }

    const html = renderTokens([token], allowBlockHtml);
    if (html) {
      blocks.push({ kind: 'html', key, html });
    }
  }

  return blocks;
}

function wrapTables(html: string): string {
  if (!html || !html.includes('<table')) {
    return html;
  }

  return html
    .replace(/<table(\s[^>]*)?>/g, '<div class="table-block-wrapper"><table$1>')
    .replace(/<\/table>/g, '</table></div>');
}

export function renderMarkdown(src: string, options: RenderMarkdownOptions = {}): string {
  const text = String(src || '');
  const useCache = options.cache !== false && text.length <= MAX_CACHEABLE_CHARS;
  const allowInlineHtml = !!options.allowInlineHtml;

  if (!useCache) {
    return withAllowHtml(allowInlineHtml, () => wrapTables(marked.parse(text) as string));
  }

  const key = `${allowInlineHtml ? '1' : '0'}:${text}`;

  // Return cached result if available
  if (cache.has(key)) {
    const cached = cache.get(key)!;
    // Move to end (LRU)
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  // Render and cache
  const result = withAllowHtml(allowInlineHtml, () => wrapTables(marked.parse(text) as string));
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
