import { createMergeRemote, type MergeRemote } from "../lib/merge-remote";
import { Log } from "./log";

declare global {
  interface Window {
    osmWorker: MergeRemote;
  }
}

const THROTTLED_PROGRESS_INTERVAL_MS = 250;
let lastThrottledProgressAt = Number.NEGATIVE_INFINITY;

export const osmWorker = await createMergeRemote({
  onProgress: (progress) => {
    if (progress.throttle) {
      const now = performance.now();
      if (now - lastThrottledProgressAt < THROTTLED_PROGRESS_INTERVAL_MS) return;
      lastThrottledProgressAt = now;
    }
    Log.addMessage(progress.msg);
  },
});

window.osmWorker = osmWorker;
