import assert from "node:assert/strict";
import { test } from "node:test";

import { Osm } from "@osmix/core";

import {
  createShortbreadServerApp,
  type ShortbreadServerDataset,
  type ShortbreadServerRemote,
} from "../app.ts";

function createDataset(): ShortbreadServerDataset {
  return {
    id: "fixture",
    isReady: async () => true,
    get: async () => new Osm({ id: "fixture" }),
    delete: async () => {},
  } as ShortbreadServerDataset;
}

function createRemote(dataset: ShortbreadServerDataset): ShortbreadServerRemote {
  return {
    fromPbf: async () => dataset,
    getWorker: () => ({ getShortbreadTile: async () => new ArrayBuffer(3) }),
  } as unknown as ShortbreadServerRemote;
}

void test("shortbread server app serves readiness and tiles without opening a port", async () => {
  const dataset = createDataset();
  const app = createShortbreadServerApp({
    remote: createRemote(dataset),
    state: { dataset, filename: "fixture.pbf", log: [] },
    indexHtml: "<html>fixture</html>",
    port: 3001,
  });

  const ready = await app.request("/ready");
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ready: true, log: [] });

  const tile = await app.request("/tiles/0/0/0");
  assert.equal(tile.status, 200);
  assert.equal(tile.headers.get("content-type"), "application/vnd.mapbox-vector-tile");
  assert.equal((await tile.arrayBuffer()).byteLength, 3);
});

void test("shortbread server app turns tile failures into a useful response", async () => {
  const dataset = createDataset();
  const remote = createRemote(dataset) as ShortbreadServerRemote & {
    getWorker: () => { getShortbreadTile: () => Promise<ArrayBuffer> };
  };
  remote.getWorker = () => ({
    getShortbreadTile: async () => {
      throw Error("fixture tile failure");
    },
  });
  const app = createShortbreadServerApp({
    remote,
    state: { dataset, filename: "fixture.pbf", log: [] },
    indexHtml: "",
    port: 3001,
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
