import { createReadStream } from "node:fs";
import { availableParallelism } from "node:os";
import { Readable } from "node:stream";

import type { Tile } from "@osmix/types";
import { selectWorkerCount } from "osmix";

import { createShortbreadRemote } from "../remote.ts";

const HEARTBEAT_MS = 25;
const MAX_MAIN_THREAD_STALL_MS = 250;
const ZOOM = 12;

function centerTile(bbox: readonly number[]): Tile {
  const longitude = (bbox[0]! + bbox[2]!) / 2;
  const latitude = Math.max(-85.051_129, Math.min(85.051_129, (bbox[1]! + bbox[3]!) / 2));
  const scale = 2 ** ZOOM;
  const x = Math.floor(((longitude + 180) / 360) * scale);
  const radians = (latitude * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale,
  );
  return [x, y, ZOOM];
}

const filePath = process.env["OSMIX_SHORTBREAD_STRESS_PBF"];
if (!filePath) {
  console.log("Set OSMIX_SHORTBREAD_STRESS_PBF to run the Node Shortbread stress harness.");
  process.exit(0);
}

const workerCount = selectWorkerCount({
  hardwareConcurrency: availableParallelism(),
  reserveCores: 1,
  maxWorkers: 4,
});
let previousHeartbeat = performance.now();
let maxMainThreadStallMs = 0;
let peakRssBytes = process.memoryUsage.rss();
const heartbeat = setInterval(() => {
  const now = performance.now();
  maxMainThreadStallMs = Math.max(maxMainThreadStallMs, now - previousHeartbeat - HEARTBEAT_MS);
  previousHeartbeat = now;
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
}, HEARTBEAT_MS);

const remote = await createShortbreadRemote({
  workerCount,
  workerUrl: new URL("../shortbread.worker.ts", import.meta.url),
});
try {
  const loadStartedAt = performance.now();
  const dataset = await remote.fromPbf(
    Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>,
    { id: "regional-shortbread-stress" },
  );
  const loadMs = performance.now() - loadStartedAt;
  const [centerX, centerY] = centerTile(dataset.bbox);
  const tiles: Tile[] = [];
  for (let y = centerY - 2; y <= centerY + 1; y++) {
    for (let x = centerX - 2; x <= centerX + 1; x++) tiles.push([x, y, ZOOM]);
  }
  const tileStartedAt = performance.now();
  const byteLengths = await Promise.all(
    tiles.map((tile) =>
      remote.runWithWorker(
        async (worker) => (await worker.getShortbreadTile(dataset.id, tile)).byteLength,
        { lane: "compute", retry: "once" },
      ),
    ),
  );
  const tileMs = performance.now() - tileStartedAt;
  const indexInfo = await remote.getFeatureIndexDiagnostics(dataset.id);

  if (maxMainThreadStallMs > MAX_MAIN_THREAD_STALL_MS) {
    throw Error(`Main thread stalled for ${maxMainThreadStallMs.toFixed(1)} ms`);
  }
  if (indexInfo.some((info) => !info || info.sharedBufferCount !== info.bufferCount)) {
    throw Error("Shortbread feature-index buffers were not shared across workers");
  }
  if (
    indexInfo.some(
      (info) => !info || info.datasetArrayBufferCount !== 0 || info.datasetSharedBufferCount === 0,
    )
  ) {
    throw Error("OSM dataset buffers were duplicated instead of shared across workers");
  }

  console.log(
    JSON.stringify({
      byteLengths,
      filePath,
      indexSize: indexInfo[0]?.size ?? 0,
      loadMs: Math.round(loadMs),
      maxMainThreadStallMs: Math.round(maxMainThreadStallMs),
      peakRssBytes,
      tileMs: Math.round(tileMs),
      workerCount,
    }),
  );
} finally {
  clearInterval(heartbeat);
  remote[Symbol.dispose]();
}
