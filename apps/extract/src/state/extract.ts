import { atom } from "jotai";
import type { GeoBbox2D } from "osmix";

import { DEFAULT_EXTRACT_BBOX } from "../lib/extract-bbox";

export const extractBboxAtom = atom<GeoBbox2D>(DEFAULT_EXTRACT_BBOX);

/** While true, the bbox is the selected file's header bounds and can't be edited or dragged. */
export const useFileBoundsAtom = atom(false);

/** What the selected file's PBF header says about its bounds. */
export type FileBounds =
  | { status: "none" }
  | { status: "reading" }
  | { status: "ok"; bbox: GeoBbox2D }
  | { status: "missing" }
  | { status: "error"; message: string };

/**
 * The selected file's header bounds. The panel resolves them when a file is picked; the map
 * outlines them while they are known, so a bbox that misses the file is visibly outside it.
 */
export const fileBoundsAtom = atom<FileBounds>({ status: "none" });
