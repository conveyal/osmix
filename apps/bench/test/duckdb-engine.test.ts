import { afterAll, beforeAll, describe, expect, it } from "vitest";

import monacoPbf from "../../../fixtures/monaco.pbf?url";
import { DuckDBEngine } from "../src/engines/duckdb-engine";
import { testGeometry } from "../src/operations";

// Browser mode is off in CI, and DuckDB needs a Web Worker.
describe.skipIf(import.meta.env["CI"] === "true")("DuckDB engine", () => {
  let engine: DuckDBEngine;
  let bbox: [number, number, number, number];

  beforeAll(async () => {
    engine = await DuckDBEngine.create();
    const data = await (await fetch(monacoPbf)).arrayBuffer();
    ({ bbox } = await engine.load(data, "monaco.pbf"));
  }, 60_000);

  afterAll(() => engine.dispose());

  it("reports the pinned duckdb-wasm build with spatial loaded", () => {
    const info = engine.info();
    expect(info.version).toContain("duckdb-wasm 1.33.1-dev57.0");
    expect(info.version).toMatch(/spatial \w+/);
    expect(info.threads).toBe(1);
  });

  it("answers a selective node bbox query from the RTREE", async () => {
    const { bboxes } = testGeometry(bbox);
    const plan = await engine.explain({ kind: "bbox-nodes", bbox: bboxes.small });
    expect(plan).toContain("RTREE_INDEX_SCAN");
  });
});
