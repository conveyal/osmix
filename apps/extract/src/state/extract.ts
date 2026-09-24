import { atom } from "jotai";
import type { GeoBbox2D } from "osmix";

import { DEFAULT_EXTRACT_BBOX } from "../lib/extract-bbox";

export const extractBboxAtom = atom<GeoBbox2D>(DEFAULT_EXTRACT_BBOX);

/** While true, the bbox is the selected file's header bounds and can't be edited or dragged. */
export const useFileBoundsAtom = atom(false);
