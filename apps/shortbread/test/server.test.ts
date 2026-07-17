import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { Osm } from "@osmix/core";

import {
  createShortbreadServerApp,
  type ShortbreadServerDataset,
  type ShortbreadServerRemote,
} from "../app.ts";
import { createShortbreadRemote } from "../remote.ts";

function createDataset(): ShortbreadServerDataset {
  const info = new Osm({ id: "fixture" }).info();
  return {
    ...info,
    isReady: async () => true,
    delete: async () => {},
  };
}

interface RecordedRunOptions {
  lane?: string;
  retry?: string;
  signal?: AbortSignal;
}

function createRemote(
  dataset: ShortbreadServerDataset,
  onRun?: (options: RecordedRunOptions) => void,
): ShortbreadServerRemote {
  return {
    fromPbf: async () => dataset,
    runWithWorker: async <R>(
      task: (worker: never, index: number) => Promise<R> | R,
      options: RecordedRunOptions,
    ) => {
      onRun?.(options);
      return task({ getShortbreadTile: async () => new ArrayBuffer(3) } as never, 0);
    },
  } as unknown as ShortbreadServerRemote;
}

void test("shortbread server app serves readiness and tiles without opening a port", async () => {
  const dataset = createDataset();
  const runs: RecordedRunOptions[] = [];
  const app = createShortbreadServerApp({
    remote: createRemote(dataset, (options) => runs.push(options)),
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
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.lane, "compute");
  assert.equal(runs[0]?.retry, "once");
  assert.ok(runs[0]?.signal instanceof AbortSignal);
});

void test("shortbread server app turns tile failures into a useful response", async () => {
  const dataset = createDataset();
  const remote = {
    ...createRemote(dataset),
    runWithWorker: async () => {
      throw Error("fixture tile failure");
    },
  } as unknown as ShortbreadServerRemote;
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

void test(
  "shortbread remote shares one indexed dataset across Node worker threads",
  { timeout: 120_000 },
  async () => {
    const remote = await createShortbreadRemote({
      workerCount: 2,
      workerUrl: new URL("../shortbread.worker.ts", import.meta.url),
    });
    try {
      const data = await readFile(new URL("../../../fixtures/monaco.pbf", import.meta.url));
      const dataset = await remote.fromPbf(data, { id: "node-shortbread-monaco" });
      const [controlInfo, computeInfo, controlTile, computeTile] = await Promise.all([
        remote.runWithWorker((worker) => worker.getShortbreadFeatureIndexInfo(dataset.id), {
          lane: "control",
        }),
        remote.runWithWorker((worker) => worker.getShortbreadFeatureIndexInfo(dataset.id), {
          lane: "compute",
        }),
        remote.runWithWorker((worker) => worker.getShortbreadTile(dataset.id, [17059, 11948, 15]), {
          lane: "control",
        }),
        remote.runWithWorker((worker) => worker.getShortbreadTile(dataset.id, [17059, 11948, 15]), {
          lane: "compute",
        }),
      ]);

      assert.ok(controlInfo);
      assert.deepEqual(computeInfo, controlInfo);
      assert.ok(controlInfo.size > 0);
      assert.equal(controlInfo.sharedBufferCount, controlInfo.bufferCount);
      assert.ok(controlTile.byteLength > 0);
      assert.equal(computeTile.byteLength, controlTile.byteLength);
    } finally {
      remote[Symbol.dispose]();
    }
  },
);
