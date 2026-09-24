import { Osm } from "osmix";
import { describe, expect, it } from "vitest";

import { loadedOsmFilePanels } from "../src/components/osm-file-map-control.tsx";

function loaded(osmKey: string, fileHash: string) {
  const osm = new Osm({ id: fileHash });
  return {
    osmFile: {
      osmKey,
      osm,
      osmInfo: osm.info(),
      fileInfo: { fileHash, fileName: "monaco.pbf", fileSize: 1 },
    },
  };
}

describe("OsmFileMapControl panels", () => {
  it("keys panels by role, so one file loaded as base and patch gets two panels", () => {
    const panels = loadedOsmFilePanels([loaded("base", "abc123"), loaded("patch", "abc123")]);

    expect(panels.map((panel) => panel.key)).toEqual(["base", "patch"]);
  });

  it("keeps a role's key when another role is not loaded", () => {
    const unloaded = { osmFile: { osmKey: "base", osm: null, osmInfo: null, fileInfo: null } };
    const panels = loadedOsmFilePanels([unloaded, loaded("patch", "abc123")]);

    expect(panels.map((panel) => panel.key)).toEqual(["patch"]);
  });
});
