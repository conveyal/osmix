import { Osm } from "@osmix/core";
import type { OsmPbfHeaderBlock } from "@osmix/pbf";
import { describe, expect, it } from "vitest";

import { createReadableEntityStreamFromOsm } from "../src/entity-stream.ts";

describe("createReadableEntityStreamFromOsm", () => {
  it("records the replication timestamp in seconds, as the PBF format defines it", async () => {
    const osm = new Osm({ id: "header" });
    osm.buildIndexes();
    const before = Math.floor(Date.now() / 1000);
    const reader = createReadableEntityStreamFromOsm(osm).getReader();
    const header = (await reader.read()).value as OsmPbfHeaderBlock;
    await reader.cancel();
    expect(header.writingprogram).toBe("@osmix/core");
    expect(header.osmosis_replication_timestamp).toBeGreaterThanOrEqual(before);
    expect(header.osmosis_replication_timestamp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });
});
