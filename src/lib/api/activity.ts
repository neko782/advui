// ============================================================================
// Activity: what the model did besides writing the reply.
// Providers report thinking and tool calls into an ActivityLog; the UI turns
// each step into a one-line title with activityTitle().
// ============================================================================

import type { ActivityKind, ActivityStatus, ActivityStep } from '../types/index.js';

/** Tool payloads are stored with the chat, so very long ones are cut. */
const MAX_DETAIL_CHARS = 20000;
const MAX_TITLE_CHARS = 140;

export function clipDetail(text: string): string {
  return text.length > MAX_DETAIL_CHARS
    ? `${text.slice(0, MAX_DETAIL_CHARS)}\n… ${text.length - MAX_DETAIL_CHARS} more characters`
    : text;
}

/** Pretty-prints JSON payloads; anything else is returned as it came. */
export function prettyJson(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw !== 'string') {
    try { return JSON.stringify(raw, null, 2) ?? ''; } catch { return String(raw); }
  }
  const text = raw.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return raw;
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return raw; }
}

type StepPatch = Partial<Omit<ActivityStep, 'id'>>;
type TextField = 'text' | 'input' | 'output';

/**
 * Ordered, mutable list of steps for one reply. Every change reports the
 * whole list to `onChange`, so the UI can follow along while streaming.
 */
export class ActivityLog {
  private entries = new Map<string, { step: ActivityStep; order: number; seq: number }>();
  private seq = 0;

  constructor(private onChange?: (steps: ActivityStep[]) => void) {}

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): ActivityStep | undefined {
    return this.entries.get(id)?.step;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Creates or updates a step. `order` places it among the others (provider
   * output position); steps without one keep the order they were added in.
   */
  set(id: string, patch: StepPatch, order?: number): void {
    const existing = this.entries.get(id);
    const clean: StepPatch = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      (clean as Record<string, unknown>)[key] = typeof value === 'string' && key !== 'kind' && key !== 'status'
        ? clipDetail(value)
        : value;
    }
    if (existing) {
      existing.step = { ...existing.step, ...clean };
      if (order != null) existing.order = order;
    } else {
      this.entries.set(id, {
        step: { kind: 'tool', status: 'running', ...clean, id },
        order: order ?? Number.MAX_SAFE_INTEGER,
        seq: this.seq++,
      });
    }
    this.emit();
  }

  /** Appends streamed text to a step's field, creating the step if needed. */
  append(id: string, field: TextField, delta: string, create?: StepPatch, order?: number): void {
    if (!delta) return;
    const existing = this.entries.get(id)?.step;
    const current = existing?.[field] ?? '';
    if (current.length >= MAX_DETAIL_CHARS) return;
    this.set(id, { ...(existing ? {} : create), [field]: current + delta }, order);
  }

  remove(id: string): void {
    if (this.entries.delete(id)) this.emit();
  }

  /** Snapshot in display order. Thinking that produced no text is left out once finished. */
  list(): ActivityStep[] {
    return [...this.entries.values()]
      .sort((a, b) => (a.order - b.order) || (a.seq - b.seq))
      .map(entry => entry.step)
      .filter(step => !(step.kind === 'thinking' && step.status !== 'running' && !step.text?.trim()))
      .map(step => ({ ...step }));
  }

  /** Marks everything still running as finished and returns the final list. */
  settle(): ActivityStep[] {
    let changed = false;
    for (const entry of this.entries.values()) {
      if (entry.step.status === 'running') {
        entry.step = { ...entry.step, status: 'done' };
        changed = true;
      }
    }
    if (changed) this.emit();
    return this.list();
  }

  private emit(): void {
    if (!this.onChange) return;
    try { this.onChange(this.list()); } catch { /* ignore */ }
  }
}

/** Finishes any step left running, e.g. when a reply is stopped or fails. */
export function settleActivity(steps: ActivityStep[] | undefined): ActivityStep[] | undefined {
  if (!Array.isArray(steps) || !steps.length) return undefined;
  const settled = steps
    .map(step => (step.status === 'running' ? { ...step, status: 'done' as ActivityStatus } : step))
    .filter(step => !(step.kind === 'thinking' && !step.text?.trim()));
  return settled.length ? settled : undefined;
}

// ============================================================================
// Titles
// ============================================================================

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TITLE_CHARS ? `${flat.slice(0, MAX_TITLE_CHARS - 1)}…` : flat;
}

function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*(#{1,6}|[-*+>]|\d+[.)])\s+/, '')
    .replace(/[*_`]+/g, '')
    .trim();
}

/**
 * One line for a block of reasoning: its latest bold heading when the
 * provider writes summaries with headings, otherwise the line being written
 * (while running) or the opening line (once done).
 */
export function thinkingTitle(text: string | undefined, running: boolean): string {
  const source = text || '';
  const headings = [...source.matchAll(/^\s*\*\*([^*\n]+)\*\*\s*$/gm)];
  const heading = headings[headings.length - 1]?.[1]?.trim();
  if (heading) return oneLine(heading);
  const lines = source.split('\n').map(stripMarkdown).filter(Boolean);
  if (!lines.length) return running ? 'Thinking' : 'Thought';
  return oneLine((running ? lines[lines.length - 1] : lines[0]) || '');
}

const TOOL_VERBS: Record<Exclude<ActivityKind, 'thinking' | 'tool'>, { running: string; done: string; bare: string; join: string }> = {
  search: { running: 'Searching the web', done: 'Searched the web', bare: '', join: ' for ' },
  fetch: { running: 'Reading', done: 'Read', bare: ' a page', join: ' ' },
  code: { running: 'Running', done: 'Ran', bare: ' code', join: ' ' },
  shell: { running: 'Running', done: 'Ran', bare: ' a command', join: ' ' },
  image: { running: 'Generating an image', done: 'Generated an image', bare: '', join: ': ' },
  mcp: { running: 'Calling', done: 'Called', bare: ' a tool', join: ' ' },
  mcp_list: { running: 'Loading', done: 'Loaded', bare: ' tools', join: ' ' },
};

/** The one-line summary shown for a step. */
export function activityTitle(step: ActivityStep, live = true): string {
  const running = live && step.status === 'running';
  if (step.kind === 'thinking') return thinkingTitle(step.text, running);

  const subject = step.subject ? oneLine(step.subject) : '';
  let title: string;
  if (step.kind === 'tool') {
    title = subject || (running ? 'Using a tool' : 'Used a tool');
  } else {
    const verbs = TOOL_VERBS[step.kind];
    const quoted = step.kind === 'search' && subject ? `“${subject}”` : subject;
    title = `${running ? verbs.running : verbs.done}${quoted ? `${verbs.join}${quoted}` : verbs.bare}`;
    if (step.server && (step.kind === 'mcp' || step.kind === 'mcp_list')) {
      title += ` ${step.kind === 'mcp' ? 'on' : 'from'} ${step.server}`;
    }
  }
  return step.status === 'failed' ? `${title} — failed` : title;
}

/** Whether a step has anything to show when opened. */
export function activityHasDetail(step: ActivityStep): boolean {
  if (step.kind === 'thinking') return !!step.text?.trim();
  return !!(step.input?.trim() || step.output?.trim() || step.error?.trim());
}

// ============================================================================
// Chats saved before activity steps existed
// ============================================================================

/**
 * A message's steps. Older chats stored a single reasoning text and a list
 * of MCP calls instead; those are read as steps so they still show.
 */
export function activityOf(message: unknown): ActivityStep[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  if (Array.isArray(msg.activity)) return msg.activity as ActivityStep[];

  const steps: ActivityStep[] = [];
  const reasoning = msg.reasoningSummary;
  if (typeof reasoning === 'string' && reasoning.trim()) {
    steps.push({ id: 'legacy-reasoning', kind: 'thinking', status: 'done', text: reasoning });
  }
  if (Array.isArray(msg.mcpItems)) {
    for (const entry of msg.mcpItems as Array<Record<string, unknown>>) {
      if (entry?.type !== 'mcp_call') continue;
      const str = (key: string) => (typeof entry[key] === 'string' ? entry[key] as string : undefined);
      const error = str('error');
      steps.push({
        id: `legacy-mcp-${str('id') || steps.length}`,
        kind: 'mcp',
        status: error ? 'failed' : 'done',
        subject: str('name'),
        server: str('serverLabel'),
        input: prettyJson(str('arguments')) || undefined,
        output: prettyJson(str('output')) || undefined,
        error,
      });
    }
  }
  return steps;
}
