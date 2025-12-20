import { Marked } from 'marked';
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Custom renderer shared between instances
const customRenderer = {
  renderer: {
    code(token) {
      const rawCode = token.text;
      const specifiedLang = token.lang || '';
      const skipHighlight = (
        rawCode.length > MAX_HIGHLIGHT_CHARS ||
        rawCode.split(/\r?\n/).length > MAX_HIGHLIGHT_LINES
      );

      let code = rawCode;
      let langLabel = specifiedLang;

      if (!skipHighlight) {
        if (specifiedLang && hljs.getLanguage(specifiedLang)) {
          try {
            code = hljs.highlight(rawCode, { language: specifiedLang, ignoreIllegals: true }).value;
          } catch {
            code = escapeHtml(rawCode);
          }
        } else if (!specifiedLang) {
          try {
            const result = hljs.highlightAuto(rawCode);
            code = result.value;
            langLabel = result.language || 'text';
          } catch {
            code = escapeHtml(rawCode);
            langLabel = 'text';
          }
        } else {
          code = escapeHtml(rawCode);
          langLabel = specifiedLang;
        }
      } else {
        code = escapeHtml(rawCode);
        if (!langLabel) {
          langLabel = 'text';
        }
      }

      return `<div class="code-block-wrapper">
<div class="code-block-header">
<span class="code-lang">${escapeHtml(langLabel)}</span>
<button type="button" class="code-copy-btn" aria-label="Copy code">Copy</button>
</div>
<pre><code class="hljs language-${escapeHtml(langLabel)}">${code}</code></pre>
</div>`;
    },

    link(token) {
      const href = token.href;
      const title = token.title;
      const text = token.tokens ? this.parser!.parseInline(token.tokens) : token.text;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
};

// Create two marked instances: one with HTML disabled (default), one with HTML enabled
const markedNoHtml = new Marked({ breaks: true, gfm: true });
markedNoHtml.use(customRenderer);

const markedWithHtml = new Marked({ breaks: true, gfm: true });
markedWithHtml.use(customRenderer);

// LRU cache for rendered markdown (max 200 entries to avoid memory bloat)
// Separate caches for html-enabled and html-disabled to avoid conflicts
const cacheNoHtml = new Map<string, string>();
const cacheWithHtml = new Map<string, string>();
const MAX_CACHE_SIZE = 200;

export interface RenderMarkdownOptions {
  allowInlineHtml?: boolean;
}

export function renderMarkdown(src: string, options: RenderMarkdownOptions = {}): string {
  const { allowInlineHtml = false } = options;
  const key = String(src || '');
  const cache = allowInlineHtml ? cacheWithHtml : cacheNoHtml;
  const marked = allowInlineHtml ? markedWithHtml : markedNoHtml;

  // Return cached result if available
  if (cache.has(key)) {
    const cached = cache.get(key)!;
    // Move to end (LRU)
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  // Render and cache
  const result = marked.parse(key) as string;
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
