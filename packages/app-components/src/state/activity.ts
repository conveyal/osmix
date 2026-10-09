import type { ActivityEntry } from "@osmix/app-core";
import { atom } from "jotai";

/** Whether the Activity sheet is open. The nav's Activity button and task toasts open it. */
export const activitySheetOpenAtom = atom(false);

/**
 * The id of the newest top-level error the user has seen: set when the Activity sheet opens and
 * when that error's toast is dismissed. The Activity button shows an error dot until then.
 */
export const acknowledgedErrorIdAtom = atom<string | null>(null);

/** The id of the newest top-level entry that failed: an error message or a failed task. */
export function latestErrorId(entries: readonly ActivityEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry) continue;
    if (entry.kind === "message" ? entry.level === "error" : entry.status === "error") {
      return entry.id;
    }
  }
  return null;
}
