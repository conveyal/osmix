import type { Progress } from "osmix";

import type { Log } from "../state/log.ts";

const DEFAULT_THROTTLE_INTERVAL_MS = 250;

/**
 * Build an `onProgress` handler for `createOsmixAppRemote` that forwards worker progress to the
 * log, dropping throttled messages that arrive within `intervalMs` of the previous one.
 */
export function createThrottledProgressLogger(
  log: typeof Log,
  intervalMs = DEFAULT_THROTTLE_INTERVAL_MS,
): (progress: Progress) => void {
  let lastThrottledProgressAt = Number.NEGATIVE_INFINITY;
  return (progress) => {
    if (progress.throttle) {
      const now = performance.now();
      if (now - lastThrottledProgressAt < intervalMs) return;
      lastThrottledProgressAt = now;
    }
    log.addMessage(progress.msg);
  };
}
