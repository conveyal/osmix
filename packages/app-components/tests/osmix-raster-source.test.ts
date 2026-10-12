import { Osm } from "osmix";
import { describe, expect, it } from "vitest";

import { OsmixMapSources } from "../src/components/osmix-map-sources.tsx";
import OsmixRasterSource from "../src/components/osmix-raster-source.tsx";
import { osmixIdToTileUrl, RASTER_URL_PATTERN } from "../src/lib/osmix-raster-protocol.ts";

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
      baseOsm: new Osm({ id: "yakima-base" }),
      patchOsm: new Osm({ id: "yakima-osw" }),
    });
    const afterMerge = OsmixMapSources({
      baseOsm: new Osm({ id: "yakima-merged" }),
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

  it("prefixes raster ids with the role, so one file in both slots gets two sources", () => {
    const base = OsmixRasterSource({ osmId: "abc123" });
    const patch = OsmixRasterSource({ osmId: "abc123", role: "patch" });

    expect(base.props.id).toBe("osmix:base:abc123:256:raster");
    expect(patch.props.id).toBe("osmix:patch:abc123:256:raster");
    expect(base.key).not.toBe(patch.key);
  });

  it("hides a raster layer with visible={false} instead of unmounting it", () => {
    const shown = OsmixRasterSource({ osmId: "yakima-base" });
    const hidden = OsmixRasterSource({ osmId: "yakima-base", visible: false });
    const layerLayout = (source: ReturnType<typeof OsmixRasterSource>) =>
      (source.props.children as React.ReactElement<{ layout: { visibility: string } }>).props
        .layout;

    expect(layerLayout(shown)).toEqual({ visibility: "visible" });
    expect(layerLayout(hidden)).toEqual({ visibility: "none" });
    expect(hidden.key).toBe(shown.key);
  });

  it("passes visible={false} through to the raster source and the vector overlay", () => {
    const sources = OsmixMapSources({
      baseOsm: new Osm({ id: "yakima-base" }),
      patchOsm: new Osm({ id: "yakima-osw" }),
      patchVisible: false,
    });
    const visibility = (sources.props.children as React.ReactElement<{ visible?: boolean }>[])
      .filter(Boolean)
      .map((child) => child.props.visible);
    expect(visibility).toEqual([true, false, true, false]);
    expect(childKeys(sources)).toEqual([
      "base:raster:yakima-base",
      "patch:raster:yakima-osw",
      "base:overlay:yakima-base",
      "patch:overlay:yakima-osw",
    ]);
  });

  it("draws the patch dataset in the patch color", () => {
    const sources = OsmixMapSources({
      baseOsm: new Osm({ id: "yakima-base" }),
      patchOsm: new Osm({ id: "yakima-osw" }),
    });
    const roles = (sources.props.children as React.ReactElement<{ role?: string }>[])
      .filter(Boolean)
      .map((child) => child.props.role ?? "base");
    expect(roles).toEqual(["base", "patch", "base", "patch"]);
  });

  it("encodes the color role in raster tile URLs", () => {
    const url = osmixIdToTileUrl("a/b", 512, "patch")
      .replace("{z}", "3")
      .replace("{x}", "4")
      .replace("{y}", "5");
    expect(RASTER_URL_PATTERN.exec(url)?.slice(1)).toEqual([
      "a%2Fb",
      "512",
      "3",
      "4",
      "5",
      "patch",
    ]);
    const legacy = "@osmix/raster://base/256/1/2/3.png";
    expect(RASTER_URL_PATTERN.exec(legacy)?.[6]).toBeUndefined();
  });
});
