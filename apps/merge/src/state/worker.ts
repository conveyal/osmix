import { createMergeRemote, type MergeRemote } from "../lib/merge-remote";
import { Log } from "./log";

declare global {
  interface Window {
    osmWorker: MergeRemote;
  }
}

const BLOCK_PROGRESS_INTERVAL_MS = 250;
let lastBlockProgressAt = Number.NEGATIVE_INFINITY;

export const osmWorker = await createMergeRemote({
  onProgress: (progress) => {
    if (progress.msg.startsWith("Processed ")) {
      const now = performance.now();
      if (now - lastBlockProgressAt < BLOCK_PROGRESS_INTERVAL_MS) return;
      lastBlockProgressAt = now;
    }
    Log.addMessage(progress.msg);
  },
});

window.osmWorker = osmWorker;
