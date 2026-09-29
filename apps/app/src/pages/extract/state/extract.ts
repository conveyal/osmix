import { atom } from "jotai";
import type { ExtractStrategy, GeoBbox2D, OsmPbfHeaderBlock } from "osmix";

import type { ExtractParameters } from "../components/extract-result-stats";
import {
  conveyalTagFilterEditorState,
  type TagFilterEditorState,
} from "../components/extract-tag-filter-editor";
import { DEFAULT_EXTRACT_BBOX } from "../lib/extract-bbox";

export const extractBboxAtom = atom<GeoBbox2D>(DEFAULT_EXTRACT_BBOX);

/**
 * The bbox the app last set on its own: the default, then a selected file's header bounds.
 * While the bbox still equals it, the user hasn't edited it, so selecting another file may
 * replace it with that file's bounds.
 */
export const automaticBboxAtom = atom<GeoBbox2D>(DEFAULT_EXTRACT_BBOX);

/** While true, the bbox is the selected file's header bounds and can't be edited or dragged. */
export const useFileBoundsAtom = atom(false);

/**
 * The selected source's bounds: what a streamed PBF's header records, or a loaded dataset's
 * extent.
 */
export type FileBounds =
  | { status: "none" }
  | { status: "reading" }
  | { status: "ok"; bbox: GeoBbox2D; from: "header" | "dataset" }
  | { status: "missing" }
  | { status: "error"; message: string };

/**
 * The selected file's header bounds. The panel resolves them when a file is picked; the map
 * outlines them while they are known, so a bbox that misses the file is visibly outside it.
 */
export const fileBoundsAtom = atom<FileBounds>({ status: "none" });

/** The bbox from before "Use the selected file's bounds" was turned on, to give back after. */
export const bboxBeforeFileBoundsAtom = atom<GeoBbox2D | null>(null);

/** The extract strategy chosen in step 3. */
export const extractStrategyAtom = atom<ExtractStrategy>("complete_ways");

/** The tag filter rules being edited in step 4. */
// `conveyalTagFilterEditorState` is a factory: passed to `atom` it would make a read-only atom.
export const extractTagFilterEditorAtom = atom<TagFilterEditorState>(
  conveyalTagFilterEditorState(),
);

/** The source PBF selected in step 1, not loaded: the extract streams it. */
export const extractSourceFileAtom = atom<File | null>(null);

/**
 * A PBF handed to Extract from another page ("Open in Extract" on a file too large to load).
 * The Extract panel takes it as its source when it mounts, then clears this.
 */
export const extractIncomingFileAtom = atom<File | null>(null);

/** The selected source's PBF header. */
export const extractSourceHeaderAtom = atom<OsmPbfHeaderBlock | null>(null);

/** The settings the current extract result was made with. */
export const extractParametersAtom = atom<ExtractParameters | null>(null);

/**
 * Make a dataset the next extract's source, as when it arrives from another page: forget any
 * selected file, show the dataset's extent, and start an unedited bbox from it. The caller has
 * put the dataset in the source slot.
 */
export const datasetAsExtractSourceAtom = atom(null, (get, set, extent: GeoBbox2D | null) => {
  set(extractSourceFileAtom, null);
  set(extractSourceHeaderAtom, null);
  set(extractParametersAtom, null);
  const before = get(bboxBeforeFileBoundsAtom);
  if (get(useFileBoundsAtom) && before) set(extractBboxAtom, before);
  set(useFileBoundsAtom, false);
  set(bboxBeforeFileBoundsAtom, null);
  set(
    fileBoundsAtom,
    extent ? { status: "ok", bbox: extent, from: "dataset" } : { status: "missing" },
  );
  if (!extent) return;
  const current = get(extractBboxAtom);
  const automatic = get(automaticBboxAtom);
  if (current.every((value, i) => value === automatic[i])) {
    set(extractBboxAtom, extent);
    set(automaticBboxAtom, extent);
  }
});
