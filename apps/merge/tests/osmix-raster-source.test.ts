import { Osm } from "osmix";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/state/worker", () => ({ osmWorker: {} }));

import { OsmixMapSources } from "../src/components/osmix-map-sources";
import OsmixRasterSource from "../src/components/osmix-raster-source";

function childKeys(element: ReturnType<typeof OsmixMapSources>) {
  return (element.props.children as React.ReactElement[]).filter(Boolean).map((child) => child.key);
}

describe("Osmix map sources", () => {
  it("remounts when a merge replaces the dataset ID", () => {
    const beforeMerge = OsmixRasterSource({ osmId: "yakima-base", tileSize: 512 });
    const afterMerge = OsmixRasterSource({ osmId: "yakima-merged", tileSize: 512 });

    expect(beforeMerge.key).toBe(beforeMerge.props.id);
    expect(afterMerge.key).toBe(afterMerge.props.id);
    expect(afterMerge.key).not.toBe(beforeMerge.key);
  });

  it("replaces base and patch source wrappers after a merge", () => {
    const beforeMerge = OsmixMapSources({
      activeTab: "Merge",
      baseOsm: new Osm({ id: "yakima-base" }),
      extractOsm: null,
      patchOsm: new Osm({ id: "yakima-osw" }),
    });
    const afterMerge = OsmixMapSources({
      activeTab: "Merge",
      baseOsm: new Osm({ id: "yakima-merged" }),
      extractOsm: null,
      patchOsm: null,
    });

    expect(childKeys(beforeMerge)).toEqual([
      "base:raster:yakima-base",
      "patch:raster:yakima-osw",
      "base:overlay:yakima-base",
      "patch:overlay:yakima-osw",
    ]);
    expect(childKeys(afterMerge)).toEqual([
      "base:raster:yakima-merged",
      "base:overlay:yakima-merged",
    ]);
  });
});
