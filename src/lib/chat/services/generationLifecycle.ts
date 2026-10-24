// Generation lifecycle: the single owner of "is this chat generating, and
// which request is allowed to write into it".
//
//   idle ──begin──▶ generating ──settle(run)──▶ idle
//                       │
//                     stop
//                       ▼
//                   stopping ──settle(stopped run)──▶ idle
//                       │
//                     begin (a new run may start while the old one winds down)
//                       ▼
//                   generating
//
// Each begin() returns a GenerationRun token. Only the current run may apply
// streamed updates (run.isCurrent()); a stopped or superseded run keeps
// executing until its request settles but every late update is discarded.
// stop() releases the UI immediately and aborts the transport, even when the
// request registers its abort handler after stop() was called.

export type GenerationPhase = 'idle' | 'generating' | 'stopping';

export interface GenerationSnapshot {
  phase: GenerationPhase;
  /** Run that is generating, or being stopped. */
  sequence: number | null;
  typingVariantId: number | null;
  chatId: string | null;
}

export interface GenerationRun {
  readonly sequence: number;
  readonly chatId: string;
  readonly typingVariantId: number;
  /** True while this run owns the chat and may write into it. */
  isCurrent(): boolean;
  /** Registers the transport abort. Runs immediately if already stopped. */
  setAbort(fn: (() => void) | null): void;
}

export interface GenerationLifecycle {
  readonly phase: GenerationPhase;
  snapshot(): GenerationSnapshot;
  /** Starts a run, or returns null while another run is generating. */
  begin(options: { chatId: string; typingVariantId: number }): GenerationRun | null;
  /** Stops the generating run (if any) and returns it. */
  stop(): GenerationRun | null;
  /** Reports that a run's request finished, successfully or not. */
  settle(run: GenerationRun): void;
  /** Stops any run; later transitions no longer notify. */
  dispose(): void;
}

export interface GenerationLifecycleOptions {
  onChange?: (next: GenerationSnapshot, previous: GenerationSnapshot) => void;
}

interface RunRecord extends GenerationRun {
  abort: (() => void) | null;
  aborted: boolean;
  stopped: boolean;
}

export function createGenerationLifecycle(options: GenerationLifecycleOptions = {}): GenerationLifecycle {
  let phase: GenerationPhase = 'idle';
  let active: RunRecord | null = null;
  let sequence = 0;
  let disposed = false;

  function snapshot(): GenerationSnapshot {
    return {
      phase,
      sequence: active?.sequence ?? null,
      typingVariantId: active?.typingVariantId ?? null,
      chatId: active?.chatId ?? null,
    };
  }

  function transition(nextPhase: GenerationPhase, nextActive: RunRecord | null): void {
    const previous = snapshot();
    phase = nextPhase;
    active = nextActive;
    if (disposed) return;
    try { options.onChange?.(snapshot(), previous); } catch { /* listener errors never break the lifecycle */ }
  }

  function runAbort(run: RunRecord): void {
    if (run.aborted || typeof run.abort !== 'function') return;
    run.aborted = true;
    try { run.abort(); } catch { /* ignore abort handler errors */ }
  }

  function stopRun(run: RunRecord): void {
    run.stopped = true;
    runAbort(run);
  }

  function begin({ chatId, typingVariantId }: { chatId: string; typingVariantId: number }): GenerationRun | null {
    if (disposed || phase === 'generating') return null;
    // A run still winding down after stop() is abandoned to settle on its own.
    sequence += 1;
    const run: RunRecord = {
      sequence,
      chatId,
      typingVariantId,
      abort: null,
      aborted: false,
      stopped: false,
      isCurrent: () => !run.stopped && active === run && phase === 'generating',
      setAbort: (fn) => {
        run.abort = typeof fn === 'function' ? fn : null;
        if (run.stopped) runAbort(run);
      },
    };
    transition('generating', run);
    return run;
  }

  function stop(): GenerationRun | null {
    if (phase !== 'generating' || !active) return null;
    const run = active;
    stopRun(run);
    transition('stopping', run);
    return run;
  }

  function settle(run: GenerationRun): void {
    const record = run as RunRecord;
    if (active !== record) {
      // Superseded run: make sure its transport is released, nothing else.
      if (record.stopped) runAbort(record);
      return;
    }
    transition('idle', null);
  }

  function dispose(): void {
    if (active) stopRun(active);
    disposed = true;
    phase = 'idle';
    active = null;
  }

  return {
    get phase() { return phase; },
    snapshot,
    begin,
    stop,
    settle,
    dispose,
  };
}
