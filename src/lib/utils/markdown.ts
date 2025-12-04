import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type Renderer from 'markdown-it/lib/renderer.mjs';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import hljs from 'highlight.js/lib/core';
// Load languages
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import lua from 'highlight.js/lib/languages/lua';
import diff from 'highlight.js/lib/languages/diff';
import ini from 'highlight.js/lib/languages/ini';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import nginx from 'highlight.js/lib/languages/nginx';
import graphql from 'highlight.js/lib/languages/graphql';
import plaintext from 'highlight.js/lib/languages/plaintext';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('java', java);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('php', php);
hljs.registerLanguage('lua', lua);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('nginx', nginx);
hljs.registerLanguage('graphql', graphql);
hljs.registerLanguage('plaintext', plaintext);

// Aliases
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('py', python);
hljs.registerLanguage('rb', ruby);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('zsh', bash);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('svg', xml);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('toml', ini);
hljs.registerLanguage('docker', dockerfile);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('text', plaintext);

// markdown-it instance configured for our chat bubbles
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: true,
});
md.disable('code'); // disallow indented code blocks; require fenced blocks

// Custom fence renderer to add copy button
const defaultFence = md.renderer.rules.fence || function(
  tokens: Token[],
  idx: number,
  options: MarkdownIt.Options,
  _env: unknown,
  self: Renderer
): string {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.fence = function(
  tokens: Token[],
  idx: number,
  options: MarkdownIt.Options,
  env: unknown,
  self: Renderer
): string {
  const token = tokens[idx]!;
  const info = token.info ? token.info.trim() : '';
  const specifiedLang = info.split(/\s+/g)[0] || '';

  // Get the highlighted content and detect language if not specified
  let code = token.content;
  let langLabel = specifiedLang;

  if (specifiedLang && hljs.getLanguage(specifiedLang)) {
    // Language specified, use it
    try {
      code = hljs.highlight(code, { language: specifiedLang, ignoreIllegals: true }).value;
    } catch {
      code = md.utils.escapeHtml(code);
    }
  } else if (!specifiedLang) {
    // No language specified, auto-detect
    try {
      const result = hljs.highlightAuto(code);
      code = result.value;
      langLabel = result.language || 'text';
    } catch {
      code = md.utils.escapeHtml(code);
      langLabel = 'text';
    }
  } else {
    // Unknown language, just escape
    code = md.utils.escapeHtml(code);
    langLabel = specifiedLang;
  }

  // Build the code block with header containing language label and copy button
  return `<div class="code-block-wrapper">
<div class="code-block-header">
<span class="code-lang">${md.utils.escapeHtml(langLabel)}</span>
<button type="button" class="code-copy-btn" aria-label="Copy code">Copy</button>
</div>
<pre><code class="hljs language-${md.utils.escapeHtml(langLabel)}">${code}</code></pre>
</div>`;
};

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

