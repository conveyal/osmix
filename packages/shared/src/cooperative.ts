/** Result of running an iterator in cooperative event-loop slices. */
export type CooperativeRunResult<T> = { status: "completed"; value: T } | { status: "cancelled" };

export interface RunCooperativelyOptions {
  /** Maximum synchronous work per slice. Defaults to 8 milliseconds. */
  timeSliceMs?: number;
  /** Monotonic clock seam for deterministic tests. */
  now?: () => number;
  /** Event-loop yield seam for deterministic tests and alternate runtimes. */
  yieldToEventLoop?: () => Promise<void>;
  /** Checked between iterator steps and before each event-loop yield. */
  isCancelled?: () => boolean;
}

function currentTimeMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Run a synchronous iterator in bounded slices, yielding to the event loop between slices.
 *
 * The iterator should expose natural work boundaries by yielding regularly. Cancellation is
 * cooperative: when observed, the iterator is closed and no further steps are evaluated.
 */
export async function runCooperatively<T>(
  iterator: Iterator<unknown, T>,
  options: RunCooperativelyOptions = {},
): Promise<CooperativeRunResult<T>> {
  const timeSliceMs = Math.max(0, options.timeSliceMs ?? 8);
  const now = options.now ?? currentTimeMs;
  const yieldToEventLoop = options.yieldToEventLoop ?? yieldMacrotask;
  const isCancelled = options.isCancelled ?? (() => false);

  while (true) {
    if (isCancelled()) {
      iterator.return?.();
      return { status: "cancelled" };
    }

    const startedAt = now();
    do {
      if (isCancelled()) {
        iterator.return?.();
        return { status: "cancelled" };
      }
      const step = iterator.next();
      if (step.done) return { status: "completed", value: step.value };
    } while (now() - startedAt < timeSliceMs);

    if (isCancelled()) {
      iterator.return?.();
      return { status: "cancelled" };
    }
    await yieldToEventLoop();
  }
}
