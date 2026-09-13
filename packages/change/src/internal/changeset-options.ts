import type { OsmChangesetOptions } from "../types.ts";

/** Validate before generating, dispatching, or cloning away inherited options. */
export function validateOrdinaryChangesetOptions(options: Partial<OsmChangesetOptions>): void {
  if ("conflation" in options && options.conflation !== undefined) {
    throw Error(
      "generateChangeset does not support conflation; use generateConflationChangeset() or merge() instead",
    );
  }
}
