import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type Renderer from 'markdown-it/lib/renderer.mjs';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import hljs from 'highlight.js/lib/core';
// Load languages - web/frontend
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import less from 'highlight.js/lib/languages/less';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import graphql from 'highlight.js/lib/languages/graphql';
// Systems/low-level
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
// JVM
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import scala from 'highlight.js/lib/languages/scala';
import groovy from 'highlight.js/lib/languages/groovy';
// .NET
import csharp from 'highlight.js/lib/languages/csharp';
import fsharp from 'highlight.js/lib/languages/fsharp';
// Apple
import swift from 'highlight.js/lib/languages/swift';
import objectivec from 'highlight.js/lib/languages/objectivec';
// Scripting
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import perl from 'highlight.js/lib/languages/perl';
import lua from 'highlight.js/lib/languages/lua';
import r from 'highlight.js/lib/languages/r';
// Functional
import haskell from 'highlight.js/lib/languages/haskell';
import elixir from 'highlight.js/lib/languages/elixir';
import erlang from 'highlight.js/lib/languages/erlang';
import clojure from 'highlight.js/lib/languages/clojure';
import lisp from 'highlight.js/lib/languages/lisp';
// Mobile
import dart from 'highlight.js/lib/languages/dart';
// Shell/config
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import powershell from 'highlight.js/lib/languages/powershell';
import yaml from 'highlight.js/lib/languages/yaml';
import ini from 'highlight.js/lib/languages/ini';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import nginx from 'highlight.js/lib/languages/nginx';
import apache from 'highlight.js/lib/languages/apache';
import makefile from 'highlight.js/lib/languages/makefile';
import cmake from 'highlight.js/lib/languages/cmake';
// Data/query
import sql from 'highlight.js/lib/languages/sql';
import protobuf from 'highlight.js/lib/languages/protobuf';
// Docs/misc
import markdown from 'highlight.js/lib/languages/markdown';
import latex from 'highlight.js/lib/languages/latex';
import diff from 'highlight.js/lib/languages/diff';
import plaintext from 'highlight.js/lib/languages/plaintext';
import wasm from 'highlight.js/lib/languages/wasm';
import x86asm from 'highlight.js/lib/languages/x86asm';

// Register all languages
const languages: Record<string, any> = {
  javascript, typescript, css, scss, less, xml, json, graphql,
  c, cpp, rust, go,
  java, kotlin, scala, groovy,
  csharp, fsharp,
  swift, objectivec,
  python, ruby, php, perl, lua, r,
  haskell, elixir, erlang, clojure, lisp,
  dart,
  bash, shell, powershell, yaml, ini, dockerfile, nginx, apache, makefile, cmake,
  sql, protobuf,
  markdown, latex, diff, plaintext, wasm, x86asm,
};
for (const [name, lang] of Object.entries(languages)) {
  hljs.registerLanguage(name, lang);
}

// Aliases
const aliases: Record<string, any> = {
  js: javascript, ts: typescript, jsx: javascript, tsx: typescript,
  py: python, rb: ruby, rs: rust, cs: csharp, fs: fsharp,
  sh: bash, zsh: bash, ps1: powershell, posh: powershell,
  yml: yaml, toml: ini, properties: ini,
  html: xml, svg: xml, xhtml: xml,
  docker: dockerfile, make: makefile,
  md: markdown, tex: latex,
  asm: x86asm, assembly: x86asm,
  objc: objectivec, 'm': objectivec,
  text: plaintext, txt: plaintext,
  proto: protobuf,
  el: elixir, ex: elixir,
  hs: haskell, erl: erlang, clj: clojure,
  pl: perl, raku: perl,
};
for (const [alias, lang] of Object.entries(aliases)) {
  hljs.registerLanguage(alias, lang);
}

// markdown-it instance configured for our chat bubbles
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: true,
});
md.disable('code'); // disallow indented code blocks; require fenced blocks

// Guardrail to avoid creating thousands of DOM nodes when code blocks are huge
const MAX_HIGHLIGHT_CHARS = 20000;
const MAX_HIGHLIGHT_LINES = 400;

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
  const rawCode = token.content;
  const info = token.info ? token.info.trim() : '';
  const specifiedLang = info.split(/\s+/g)[0] || '';
  const skipHighlight = (
    rawCode.length > MAX_HIGHLIGHT_CHARS ||
    rawCode.split(/\r?\n/).length > MAX_HIGHLIGHT_LINES
  );

  // Get the highlighted content and detect language if not specified
  let code = rawCode;
  let langLabel = specifiedLang;

  if (!skipHighlight) {
    if (specifiedLang && hljs.getLanguage(specifiedLang)) {
      // Language specified, use it
      try {
        code = hljs.highlight(rawCode, { language: specifiedLang, ignoreIllegals: true }).value;
      } catch {
        code = md.utils.escapeHtml(rawCode);
      }
    } else if (!specifiedLang) {
      // No language specified, auto-detect
      try {
        const result = hljs.highlightAuto(rawCode);
        code = result.value;
        langLabel = result.language || 'text';
      } catch {
        code = md.utils.escapeHtml(rawCode);
        langLabel = 'text';
      }
    } else {
      // Unknown language, just escape
      code = md.utils.escapeHtml(rawCode);
      langLabel = specifiedLang;
    }
  } else {
    code = md.utils.escapeHtml(rawCode);
    if (!langLabel) {
      langLabel = 'text';
    }
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
