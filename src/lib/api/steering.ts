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

/** The steering notes of a reply's steps: the messages that reached the model. */
export function steerNotes(steps: Array<{ kind?: string; status?: string; text?: string; at?: number }> | undefined) {
  if (!Array.isArray(steps)) return [];
  return steps
    .filter(step => step?.kind === 'steer' && step.status === 'done' && typeof step.text === 'string' && step.text.trim())
    .map(step => ({ at: typeof step.at === 'number' && step.at >= 0 ? step.at : 0, text: step.text as string }));
}
