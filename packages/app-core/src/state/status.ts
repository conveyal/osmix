import { atom } from "jotai";

/**
 * Signal for cancelling an in-progress OSM file loading operation.
 * Set to an AbortController when loading starts, null otherwise.
 * Includes the osmKey to identify which file is being loaded.
 */
export const osmLoadingAbortControllerAtom = atom<{
  controller: AbortController;
  osmKey: string;
} | null>(null);
