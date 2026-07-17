import { fileURLToPath } from "node:url";

import { pointToTileFraction } from "@osmix/geo/tile";
import type { Tile } from "osmix";

import { createStyledTileRenderer } from "../src/tile-renderer.ts";

const fixturePath = fileURLToPath(new URL("../../../fixtures/monaco.pbf", import.meta.url));
let progressEvents = 0;
const renderer = await createStyledTileRenderer({ onProgress: () => progressEvents++ });

try {
  let timerTicks = 0;
  let maxTimerLagMs = 0;
  let previousTick = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxTimerLagMs = Math.max(maxTimerLagMs, now - previousTick - 5);
    previousTick = now;
    timerTicks++;
  }, 5);
  try {
    const info = await renderer.loadPbfFile(fixturePath, "worker-smoke");
    const bbox = info.bbox;
    const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] as const;
    const [tileX, tileY] = pointToTileFraction(center[0], center[1], 15);
    const x = Math.floor(tileX);
    const y = Math.floor(tileY);
    const tiles: Tile[] = [
      [x, y, 15],
      [x + 1, y, 15],
      [x, y + 1, 15],
      [x + 1, y + 1, 15],
    ];
    const images = await Promise.all(tiles.map((tile) => renderer.renderTile(tile, 1)));
    if (images.some((image) => image === null)) throw Error("A current tile was cancelled");
    console.log(
      JSON.stringify({
        byteLengths: images.map((image) => image!.data.byteLength),
        datasetId: info.id,
        datasetNodes: info.stats.nodes,
        hardwareConcurrency: navigator.hardwareConcurrency,
        maxTimerLagMs,
        mode: renderer.mode,
        progressEvents,
        timerTicks,
        workerCount: renderer.workerCount,
      }),
    );
  } finally {
    clearInterval(timer);
  }
} finally {
  renderer.dispose();
}
