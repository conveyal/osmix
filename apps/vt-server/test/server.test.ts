import assert from "node:assert/strict";
import { test } from "node:test";

import { Osm } from "@osmix/core";

import { createVtServerApp, type VtServerDataset, type VtServerState } from "../app.ts";

function createDataset(): VtServerDataset {
  return {
    id: "fixture",
    isReady: async () => true,
    get: async () => new Osm({ id: "fixture" }),
    getVectorTile: async () => new ArrayBuffer(2),
    search: async () => ({ nodes: [], ways: [], relations: [] }),
  } as VtServerDataset;
}

void test("vt-server app serves readiness and tiles without opening a port", async () => {
  const state: VtServerState = { dataset: createDataset(), filename: "fixture.pbf", log: [] };
  const app = createVtServerApp({ state, indexHtml: "<html>fixture</html>" });

  const ready = await app.request("/ready");
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ready: true, log: [] });

  const tile = await app.request("/tiles/0/0/0");
  assert.equal(tile.status, 200);
  assert.equal(tile.headers.get("content-type"), "application/vnd.mapbox-vector-tile");
  assert.equal((await tile.arrayBuffer()).byteLength, 2);
});

void test("vt-server app turns tile failures into a useful response", async () => {
  const dataset = createDataset();
  dataset.getVectorTile = async () => {
    throw Error("fixture tile failure");
  };
  const app = createVtServerApp({
    state: { dataset, filename: "fixture.pbf", log: [] },
    indexHtml: "",
  });

  const originalError = console.error;
  console.error = () => {};
  let response: Response;
  try {
    response = await app.request("/tiles/0/0/0");
  } finally {
    console.error = originalError;
  }
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Internal server error",
    message: "fixture tile failure",
  });
});
