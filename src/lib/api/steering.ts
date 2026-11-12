// ============================================================================
// Steering
// Messages the user sends while a reply is being written. They reach the
// model the way each provider recommends for a request loop over HTTP:
//
// - At a tool boundary, in the same turn as the tool results (Anthropic:
//   text blocks after every tool_result; Gemini: text parts after the
//   functionResponse parts; Responses and Chat Completions: a user message
//   after the outputs). OpenAI's own steering prepends the message to the
//   request that returns tool results the same way.
// - While a request is streaming (thinking or writing), it is interrupted:
//   OpenAI ends a steered response as incomplete and continues in a new
//   one, and an unsigned, half-written thinking block cannot go back to
//   Anthropic. What was written so far stays as plain assistant text, the
//   message follows as a user turn, and the reply continues from there.
// - A message that arrives after the reply is finished starts a new turn.
//
// Once delivered, a message is an ordinary user message in the chat: the
// reply so far ends there and goes on in a new message (the controller's
// steerCut). The last of those messages keeps the whole run, so it replays
// as one native turn while none of them changed (buildHistory).
//
// The tool loop (toolLoop.ts) does the delivery; this is only the queue.
// ============================================================================

import type { QueuedSteer, SteerChannel } from '../types/index.js';

export class SteerQueue implements SteerChannel {
  private queue: QueuedSteer[] = [];
  private listeners = new Set<(steer: QueuedSteer) => void>();
  private seq = 0;

  /** Queues a message; returns it, or null when it is blank. */
  push(text: string): QueuedSteer | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const steer = { id: String(++this.seq), text: trimmed };
    this.queue.push(steer);
    for (const listener of [...this.listeners]) {
      try { listener(steer); } catch { /* a listener never blocks the queue */ }
    }
    return steer;
  }

  take(): QueuedSteer[] {
    const taken = this.queue;
    this.queue = [];
    return taken;
  }

  pending(): QueuedSteer[] {
    return [...this.queue];
  }

  subscribe(fn: (steer: QueuedSteer) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}

/**
 * The steering notes of a reply's steps: the messages that reached the
 * model. Only replies steered before steering messages became messages of
 * their own have them.
 */
export function steerNotes(steps: Array<{ kind?: string; status?: string; text?: string; at?: number }> | undefined) {
  if (!Array.isArray(steps)) return [];
  return steps
    .filter(step => step?.kind === 'steer' && step.status === 'done' && typeof step.text === 'string' && step.text.trim())
    .map(step => ({ at: typeof step.at === 'number' && step.at >= 0 ? step.at : 0, text: step.text as string }));
}

export type ReplyPart =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'steer'; key: string; text: string; pending: boolean };

/**
 * A reply's text split at each steering message, for showing those messages
 * as user bubbles: messages still queued (last), and in replies steered
 * before steering messages became messages of their own, the ones that
 * reached the model. Returns null when there are none.
 */
export function steeredParts(
  content: string,
  steps: Array<{ id?: string; kind?: string; status?: string; text?: string; at?: number }> | undefined,
): ReplyPart[] | null {
  if (!Array.isArray(steps)) return null;
  const steers = steps.filter(step => step?.kind === 'steer' && typeof step.text === 'string' && step.text.trim());
  if (!steers.length) return null;
  const delivered = steers
    .filter(step => step.status === 'done')
    .map((step, i) => ({ step, i, at: typeof step.at === 'number' && step.at >= 0 ? step.at : 0 }))
    .sort((a, b) => a.at - b.at || a.i - b.i);
  const parts: ReplyPart[] = [];
  let from = 0;
  for (const { step, i, at } of delivered) {
    const cut = Math.min(Math.max(Math.floor(at), from), content.length);
    const before = content.slice(from, cut).trim();
    if (before) parts.push({ kind: 'text', key: `text-${from}`, text: before });
    parts.push({ kind: 'steer', key: step.id || `steer-${i}`, text: step.text as string, pending: false });
    from = cut;
  }
  const rest = content.slice(from).trim();
  if (rest) parts.push({ kind: 'text', key: `text-${from}`, text: rest });
  steers.forEach((step, i) => {
    if (step.status === 'running') parts.push({ kind: 'steer', key: step.id || `queued-${i}`, text: step.text as string, pending: true });
  });
  return parts;
}
