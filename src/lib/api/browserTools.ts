// ============================================================================
// Browser tools
// Function tools the app runs itself, in the user's browser: they work with
// every API, since the model only asks for them and the app answers.
// ============================================================================

import type { ActivityStep, BrowserToolName } from '../types/index.js';

export interface BrowserToolSpec {
  tool: BrowserToolName;
  /** Function name the model calls. */
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: Record<string, unknown>;
}

export interface BrowserToolResult {
  output: string;
  isError: boolean;
}

const JS_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_SEARCH_RESULTS = 8;
const MAX_SEARCH_RESULTS = 20;
const EXCERPT_RADIUS = 160;

export const BROWSER_TOOL_SPECS: readonly BrowserToolSpec[] = [
  {
    tool: 'clock',
    name: 'get_current_time',
    description: "Returns the user's current local date and time, with their time zone and UTC offset. Use it whenever the answer depends on today's date or the time of day.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    tool: 'javascript',
    name: 'run_javascript',
    description: 'Runs JavaScript in an isolated sandbox in the user\'s browser and returns what it logged with console.log and the value of its last expression (when the code uses await, what it returns instead). The sandbox has no network, DOM or storage, and stops after 10 seconds. Use it for exact arithmetic, date math and processing data.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The JavaScript to run.' },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    tool: 'chatSearch',
    name: 'search_chats',
    description: "Searches the user's saved conversations in this app and returns matching excerpts, each with its chat's title and date. A message matches when it contains every word of the query.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS, description: `Most excerpts to return (default ${DEFAULT_SEARCH_RESULTS}).` },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

/** The specs of the selected tools, in display order. */
export function browserToolSpecs(tools: readonly BrowserToolName[] | undefined): BrowserToolSpec[] {
  if (!tools?.length) return [];
  return BROWSER_TOOL_SPECS.filter(spec => tools.includes(spec.tool));
}

/** Function names of the selected tools. */
export function browserToolNames(tools: readonly BrowserToolName[] | undefined): Set<string> {
  return new Set(browserToolSpecs(tools).map(spec => spec.name));
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clip(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… ${text.length - MAX_OUTPUT_CHARS} more characters`
    : text;
}

/** How a call shows in the activity list before it has a result. */
export function describeBrowserCall(name: string, args: Record<string, unknown>): Partial<ActivityStep> {
  switch (name) {
    case 'get_current_time':
      return { kind: 'time' };
    case 'run_javascript':
      return { kind: 'code', subject: 'JavaScript', input: str(args.code) || undefined };
    case 'search_chats':
      return { kind: 'chats', subject: str(args.query) || undefined };
    default:
      return { kind: 'tool', subject: name || undefined };
  }
}

// ============================================================================
// Clock
// ============================================================================

function utcOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export function currentTime(now = new Date()): string {
  const offset = utcOffset(now);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  let timeZone = '';
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* unknown */ }
  let readable = now.toString();
  try { readable = now.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' }); } catch { /* keep the default */ }
  return JSON.stringify({
    local: `${local}${offset}`,
    readable,
    timeZone: timeZone || undefined,
    utcOffset: offset,
    utc: now.toISOString(),
  }, null, 2);
}

// ============================================================================
// JavaScript sandbox
// The code runs in a Worker started from inside a sandboxed iframe: the
// iframe has an opaque origin (no access to the app, its storage or keys),
// its content security policy blocks every network request, and the Worker
// keeps a runaway loop off the page's thread. Removing the iframe ends both.
// ============================================================================

// Runs inside the Worker (or, where a sandboxed page cannot start one, the
// iframe itself). `run(code)` resolves to the reply posted back.
const RUNNER = String.raw`
const logs = [];
const show = (value) => {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value + 'n';
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (value instanceof Error) return value.stack || String(value);
  try {
    const json = JSON.stringify(value, (k, v) => (typeof v === 'bigint' ? v + 'n' : v), 2);
    return json === undefined ? String(value) : json;
  } catch { return String(value); }
};
const capture = (prefix) => (...args) => { logs.push(prefix + args.map(show).join(' ')); };
console.log = console.info = console.debug = console.trace = capture('');
console.warn = capture('[warn] ');
console.error = capture('[error] ');
const run = async (code) => {
  try {
    let value = /\bawait\b/.test(code)
      ? (0, eval)('(async () => {\n' + code + '\n})()')
      : (0, eval)(code);
    if (value && typeof value.then === 'function') value = await value;
    return { ok: true, logs, value: value === undefined ? undefined : show(value) };
  } catch (err) {
    return { ok: false, logs, error: show(err) };
  }
};
`;

const WORKER_SOURCE = `${RUNNER}\nonmessage = async (event) => { postMessage(await run(String(event.data))); };`;

const SANDBOX_HTML = `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:">
<script>
${RUNNER}
addEventListener('message', async (event) => {
  const port = event.ports[0];
  if (!port) return;
  const code = String(event.data && event.data.code || '');
  let worker = null;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(WORKER_SOURCE)}], { type: 'text/javascript' })));
  } catch {
    port.postMessage(await run(code));
    return;
  }
  worker.onmessage = (reply) => port.postMessage(reply.data);
  worker.onerror = (error) => { error.preventDefault(); port.postMessage({ ok: false, logs: [], error: error.message || 'The script failed.' }); };
  worker.postMessage(code);
});
</script>`;

interface SandboxReply {
  ok?: boolean;
  logs?: unknown;
  value?: unknown;
  error?: unknown;
}

export function formatSandboxReply(reply: SandboxReply): BrowserToolResult {
  const logs = Array.isArray(reply.logs) ? reply.logs.map(String) : [];
  const parts: string[] = [];
  if (logs.length) parts.push(logs.join('\n'));
  if (reply.ok === false) {
    parts.push(`Error: ${str(reply.error) || 'The script failed.'}`);
    return { output: clip(parts.join('\n\n')), isError: true };
  }
  if (typeof reply.value === 'string') parts.push(logs.length ? `Result: ${reply.value}` : reply.value);
  return { output: clip(parts.join('\n\n') || '(no output)'), isError: false };
}

export function runJavaScript(code: string, signal?: AbortSignal, timeoutMs = JS_TIMEOUT_MS): Promise<BrowserToolResult> {
  if (typeof document === 'undefined') {
    return Promise.resolve({ output: 'JavaScript can only run in a browser.', isError: true });
  }
  return new Promise(resolve => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.display = 'none';
    const channel = new MessageChannel();
    let done = false;
    const finish = (result: BrowserToolResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      channel.port1.close();
      iframe.remove();
      resolve(result);
    };
    const onAbort = () => finish({ output: 'Stopped.', isError: true });
    const timer = setTimeout(() => finish({
      output: `Stopped after ${Math.round(timeoutMs / 1000)} seconds without finishing.`,
      isError: true,
    }), timeoutMs);
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort);
    channel.port1.onmessage = (event) => finish(formatSandboxReply((event.data ?? {}) as SandboxReply));
    iframe.addEventListener('load', () => {
      iframe.contentWindow?.postMessage({ code }, '*', [channel.port2]);
    }, { once: true });
    iframe.srcdoc = SANDBOX_HTML;
    document.body.appendChild(iframe);
  });
}

// ============================================================================
// Chat search
// ============================================================================

interface SearchableChat {
  id: string;
  title?: string;
  updatedAt?: number;
  messages: Array<{ role: string; content: string }>;
}

function excerpt(content: string, at: number, length: number): string {
  const start = Math.max(0, at - EXCERPT_RADIUS);
  const end = Math.min(content.length, at + length + EXCERPT_RADIUS);
  const text = content.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${text}${end < content.length ? '…' : ''}`;
}

/**
 * Matching excerpts, most relevant first: messages containing the whole
 * query as a phrase, then those containing every word, newer chats first.
 */
export function searchChatMessages(chats: SearchableChat[], query: string, limit = DEFAULT_SEARCH_RESULTS): string {
  const phrase = query.trim().toLowerCase();
  const words = phrase.split(/\s+/).filter(Boolean);
  const firstWord = words[0];
  if (!firstWord) return JSON.stringify({ results: [], note: 'The query was empty.' });
  const max = Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.floor(limit) || DEFAULT_SEARCH_RESULTS));

  const hits: Array<{ rank: number; updated: number; result: Record<string, unknown> }> = [];
  for (const chat of chats) {
    for (const message of chat.messages) {
      const lower = message.content.toLowerCase();
      const phraseAt = lower.indexOf(phrase);
      if (phraseAt < 0 && !words.every(word => lower.includes(word))) continue;
      const at = phraseAt >= 0 ? phraseAt : lower.indexOf(firstWord);
      hits.push({
        rank: phraseAt >= 0 ? 0 : 1,
        updated: chat.updatedAt || 0,
        result: {
          chat: chat.title || 'Untitled chat',
          date: chat.updatedAt ? new Date(chat.updatedAt).toISOString().slice(0, 10) : undefined,
          role: message.role,
          excerpt: excerpt(message.content, at, phraseAt >= 0 ? phrase.length : firstWord.length),
        },
      });
    }
  }
  hits.sort((a, b) => (a.rank - b.rank) || (b.updated - a.updated));
  return JSON.stringify({
    results: hits.slice(0, max).map(hit => hit.result),
    total: hits.length,
  }, null, 2);
}

async function searchSavedChats(query: string, limit: number): Promise<string> {
  const [{ getChats }, { buildVisible }] = await Promise.all([
    import('../chatsStore.js'),
    import('../branching.js'),
  ]);
  const chats = await getChats();
  const searchable: SearchableChat[] = chats.map(chat => ({
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
    messages: buildVisible(chat.nodes || [], chat.rootId ?? null)
      .map(vm => vm.m)
      .filter(m => !m.typing && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: m.content })),
  }));
  return searchChatMessages(searchable, query, limit);
}

// ============================================================================
// Running a call
// ============================================================================

export async function runBrowserTool(
  name: string,
  args: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<BrowserToolResult> {
  if (!allowed.has(name)) return { output: `There is no tool named "${name}".`, isError: true };
  try {
    switch (name) {
      case 'get_current_time':
        return { output: currentTime(), isError: false };
      case 'run_javascript': {
        const code = str(args.code);
        if (!code.trim()) return { output: 'No code was given.', isError: true };
        return await runJavaScript(code, signal);
      }
      case 'search_chats': {
        const query = str(args.query);
        if (!query.trim()) return { output: 'No query was given.', isError: true };
        const limit = typeof args.limit === 'number' ? args.limit : DEFAULT_SEARCH_RESULTS;
        return { output: clip(await searchSavedChats(query, limit)), isError: false };
      }
      default:
        return { output: `There is no tool named "${name}".`, isError: true };
    }
  } catch (err) {
    return { output: err instanceof Error ? err.message : String(err), isError: true };
  }
}
