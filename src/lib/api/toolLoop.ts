// ============================================================================
// Browser tool loop
// When the model calls a browser tool, the app runs it and sends the result
// back in a new request; this repeats until the model answers without one.
// Each provider supplies one round (a request and what it adds to the
// conversation); the loop joins the rounds into a single reply.
// ============================================================================

import { browserToolNames, describeBrowserCall, runBrowserTool } from './browserTools.js';
import { clipDetail } from './activity.js';
import type { ProviderRequestContext } from './core.js';
import type { ActivityStep, GenerationResponse, GeneratedImage, NativeTurn, WebSearchResult } from '../types/index.js';

/** Most requests one reply may take while the model keeps calling tools. */
export const MAX_TOOL_ROUNDS = 12;

export interface BrowserToolCall {
  /** The provider's id for the call, to tie the result back to it. */
  id: string;
  name: string;
  /** Arguments as the provider sent them: a JSON string or an object. */
  arguments: unknown;
}

export interface ToolAnswer {
  call: BrowserToolCall;
  output: string;
  isError: boolean;
}

export interface ToolRound<T> {
  reply: GenerationResponse;
  /** Browser tool calls the round ended with. */
  calls: BrowserToolCall[];
  /** What the round adds to the conversation, in the provider's own format. */
  turn: T[];
}

export interface ToolLoopProvider<T> {
  /** Sends one request: the conversation so far plus `extra`, the earlier rounds of this reply. */
  send(ctx: ProviderRequestContext, extra: T[]): Promise<ToolRound<T>>;
  /** The entries that answer a round's calls. */
  answer(answers: ToolAnswer[]): T[];
  /** The reply as it goes back on later turns: every round, then the final one. */
  native(rounds: T[], final: ToolRound<T>, text: string): NativeTurn | undefined;
}

/** Parses call arguments; a string that is not a JSON object is reported back as an error. */
export function parseToolArguments(raw: unknown): { args: Record<string, unknown>; error?: string } {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { args: raw as Record<string, unknown> };
  if (raw == null || (typeof raw === 'string' && !raw.trim())) return { args: {} };
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { args: parsed };
    } catch { /* reported below */ }
  }
  return { args: {}, error: 'The arguments were not a valid JSON object.' };
}

function joinText(before: string, after: string): string {
  return before && after ? `${before}\n\n${after}` : before || after;
}

function mergeSearch(a: WebSearchResult | undefined, b: WebSearchResult | undefined): WebSearchResult | undefined {
  if (!a) return b;
  if (!b) return a;
  const sources = [...a.sources];
  for (const source of b.sources) if (!sources.some(s => s.url === source.url)) sources.push(source);
  return { citations: [...a.citations, ...b.citations], sources };
}

/**
 * Runs a reply that may call browser tools. Without browser tools this is a
 * single request, unchanged.
 */
export async function runToolLoop<T>(ctx: ProviderRequestContext, provider: ToolLoopProvider<T>): Promise<GenerationResponse> {
  const allowed = browserToolNames(ctx.tools.browserTools);
  if (!allowed.size) return (await provider.send(ctx, [])).reply;

  const { onTextDelta, onActivity } = ctx.callbacks;
  const signal = new AbortController();
  ctx.provideAbort(() => signal.abort());

  let text = '';
  const steps: ActivityStep[] = [];
  const transcript: T[] = [];
  let webSearchResult: WebSearchResult | undefined;
  const images: GeneratedImage[] = [];
  const report = (current: ActivityStep[] = []) => {
    try { onActivity?.([...steps, ...current]); } catch { /* ignore */ }
  };

  for (let round = 0; ; round++) {
    // Steps of later rounds get their own ids, so they never replace earlier ones.
    const tag = (list: ActivityStep[] | undefined) => (list ?? []).map(step => (round ? { ...step, id: `r${round}:${step.id}` } : step));
    const before = text;
    const roundCtx: ProviderRequestContext = {
      ...ctx,
      callbacks: {
        ...ctx.callbacks,
        onTextDelta: onTextDelta
          ? (full, delta, event) => onTextDelta(joinText(before, full), delta, event)
          : undefined,
        onActivity: onActivity ? (current) => report(tag(current)) : undefined,
      },
    };
    const result = await provider.send(roundCtx, transcript);
    text = joinText(text, result.reply.text);
    steps.push(...tag(result.reply.activity));
    webSearchResult = mergeSearch(webSearchResult, result.reply.webSearchResult);
    if (result.reply.generatedImages) images.push(...result.reply.generatedImages);

    const calls = result.calls;
    const finished = !calls.length;
    if (finished || round + 1 >= MAX_TOOL_ROUNDS || signal.signal.aborted) {
      if (!finished && !text) {
        throw new Error('The reply kept calling browser tools without answering. Regenerate to try again.');
      }
      return {
        text,
        activity: steps,
        webSearchResult,
        generatedImages: images.length ? images : undefined,
        // A reply that stopped with calls still open cannot be sent back as is.
        native: finished ? (transcript.length ? provider.native(transcript, result, text) : result.reply.native) : undefined,
      };
    }

    transcript.push(...result.turn);
    const answers: ToolAnswer[] = [];
    for (const call of calls) {
      const id = `tool-${round}-${call.id || answers.length}`;
      const { args, error } = parseToolArguments(call.arguments);
      const step: ActivityStep = { id, status: 'running', kind: 'tool', ...describeBrowserCall(call.name, args) };
      steps.push(step);
      report();
      const outcome = error
        ? { output: error, isError: true }
        : await runBrowserTool(call.name, args, allowed, signal.signal);
      Object.assign(step, outcome.isError
        ? { status: 'failed', error: clipDetail(outcome.output) }
        : { status: 'done', output: clipDetail(outcome.output) });
      report();
      answers.push({ call, ...outcome });
    }
    transcript.push(...provider.answer(answers));
  }
}
