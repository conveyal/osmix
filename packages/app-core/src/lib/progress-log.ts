import type { Progress } from "osmix";

import type { TaskStore } from "../state/tasks.ts";

const DEFAULT_THROTTLE_INTERVAL_MS = 250;

/**
 * Build an `onProgress` handler for `createOsmixAppRemote` that forwards worker progress to the
 * task store. High-frequency (`throttle`) messages replace the running step's live detail line,
 * at most once per `intervalMs`; other messages become permanent rows with their level kept.
 */
export function createThrottledProgressLogger(
  tasks: Pick<TaskStore, "detail" | "message">,
  intervalMs = DEFAULT_THROTTLE_INTERVAL_MS,
): (progress: Progress) => void {
  let lastThrottledProgressAt = Number.NEGATIVE_INFINITY;
  return (progress) => {
    if (progress.throttle) {
      const now = performance.now();
      if (now - lastThrottledProgressAt < intervalMs) return;
      lastThrottledProgressAt = now;
      tasks.detail(progress.msg);
      return;
    }
    tasks.message(progress.msg, progress.level);
  };
}
