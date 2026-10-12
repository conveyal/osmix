import { describe, expect, it } from "vitest";

import { ensureOsmPbfDownloadName, suffixOsmPbfName } from "../src/lib/osm-pbf-download-name.ts";

describe("ensureOsmPbfDownloadName", () => {
  it("replaces other extensions with .pbf", () => {
    expect(ensureOsmPbfDownloadName("foo.geojson")).toBe("foo.pbf");
    expect(ensureOsmPbfDownloadName("osmix-bar.json")).toBe("osmix-bar.pbf");
  });

  it("appends .pbf when no extension exists", () => {
    expect(ensureOsmPbfDownloadName("baz")).toBe("baz.pbf");
  });

  it("preserves existing .pbf names (case-insensitive)", () => {
    expect(ensureOsmPbfDownloadName("qux.pbf")).toBe("qux.pbf");
    expect(ensureOsmPbfDownloadName("QuX.PBF")).toBe("QuX.PBF");
    expect(ensureOsmPbfDownloadName("already.osm.pbf")).toBe("already.osm.pbf");
  });
});

describe("suffixOsmPbfName", () => {
  it("replaces the extension with the suffix and .pbf", () => {
    expect(suffixOsmPbfName("monaco.osm.pbf", "deduplicated")).toBe("monaco-deduplicated.pbf");
    expect(suffixOsmPbfName("monaco.pbf", "deduplicated")).toBe("monaco-deduplicated.pbf");
    expect(suffixOsmPbfName("roads.geojson", "deduplicated")).toBe("roads-deduplicated.pbf");
    expect(suffixOsmPbfName("roads", "deduplicated")).toBe("roads-deduplicated.pbf");
    expect(suffixOsmPbfName(".pbf", "deduplicated")).toBe("dataset-deduplicated.pbf");
  });

  it("does not repeat a suffix the name already has", () => {
    expect(suffixOsmPbfName("monaco-deduplicated.pbf", "deduplicated")).toBe(
      "monaco-deduplicated.pbf",
    );
  });
});
