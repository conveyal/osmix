import { createStore } from "jotai";
import { CONVEYAL_EXTRACT_TAG_FILTERS, normalizeTagFilterRules } from "osmix";
import { describe, expect, it } from "vitest";

import { rulesFromEditorState } from "../src/pages/extract/components/extract-tag-filter-editor";
import { extractTagFilterEditorAtom } from "../src/pages/extract/state/extract";

describe("Extract state", () => {
  it("starts from the Conveyal tag filters and accepts edits", () => {
    const store = createStore();
    expect(rulesFromEditorState(store.get(extractTagFilterEditorAtom))).toEqual(
      normalizeTagFilterRules(CONVEYAL_EXTRACT_TAG_FILTERS),
    );
    const edited = { nodes: [], ways: [], relations: [] };
    store.set(extractTagFilterEditorAtom, edited);
    expect(store.get(extractTagFilterEditorAtom)).toBe(edited);
  });
});
