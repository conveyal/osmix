import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { GenerationGate } from "@osmix/shared/generation-gate";
import { Osm, OsmixRasterTile, type Tile } from "osmix";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStyledTileRenderer,
  selectTileWorkerCount,
  tileWorkerUrl,
} from "../src/tile-renderer.ts";
import { TuiTileWorker } from "../src/tile-worker.ts";

const execFileAsync = promisify(execFile);

function indexedOsm(id: string): Osm {
  const osm = new Osm({ id });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function denselyIndexedOsm(id: string, tile: Tile, wayCount: number): Osm {
  const osm = new Osm({ id });
  const projector = new OsmixRasterTile({ tile, tileSize: 256 });
  for (let index = 0; index < wayCount; index++) {
    const y = 1 + (index % 254);
    const from = projector.tilePxToLonLat([1, y]);
    const to = projector.tilePxToLonLat([254, y]);
    const firstNodeId = index * 2 + 1;
    osm.nodes.addNode({ id: firstNodeId, lat: from[1], lon: from[0] });
    osm.nodes.addNode({ id: firstNodeId + 1, lat: to[1], lon: to[0] });
    osm.ways.addWay({
      id: index + 1,
      refs: [firstNodeId, firstNodeId + 1],
      tags: { highway: "primary" },
    });
  }
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

afterEach(() => vi.unstubAllGlobals());

describe("TUI tile workers", () => {
  it("uses shared worker-count selection while reserving one logical core", () => {
    expect(selectTileWorkerCount(1)).toBe(1);
    expect(selectTileWorkerCount(2)).toBe(1);
    expect(selectTileWorkerCount(3)).toBe(2);
    expect(selectTileWorkerCount(8)).toBe(4);
  });

  it("resolves a source or built worker beside the renderer module", () => {
    expect(tileWorkerUrl().pathname).toMatch(/\/tui\.worker\.(?:ts|js)$/);
    expect(tileWorkerUrl("file:///app/tile-renderer.ts?worker_file&type=module").pathname).toBe(
      "/app/tui.worker.ts",
    );
    expect(tileWorkerUrl("file:///app/tile-renderer.js#bundled").pathname).toBe(
      "/app/tui.worker.js",
    );
  });

  it("renders styled pixel buffers through the custom worker method", () => {
    const osm = indexedOsm("direct-worker");
    const worker = new TuiTileWorker();
    worker.transferIn(osm.transferables());

    const data = worker.getStyledRasterTile(osm.id, [0, 0, 0]);

    expect(data).toBeInstanceOf(Uint8ClampedArray);
    if (!data) throw Error("Expected a completed tile");
    expect(data.byteLength).toBe(256 * 256 * 4);
    worker.delete(osm.id);
  });

  it("cooperatively cancels stale shared-buffer tile generations", () => {
    const osm = indexedOsm("cancelled-worker");
    const worker = new TuiTileWorker();
    worker.transferIn(osm.transferables());
    const cancellation = GenerationGate.create({ initialGeneration: 4, shared: true });

    expect(
      worker.getStyledRasterTile(osm.id, [0, 0, 0], 3, cancellation.transferables()),
    ).toBeNull();
    expect(
      worker.getStyledRasterTile(osm.id, [0, 0, 0], 4, cancellation.transferables()),
    ).toBeInstanceOf(Uint8ClampedArray);
    worker.delete(osm.id);
  });

  it("cooperatively cancels stale generations without shared buffers", async () => {
    const osm = indexedOsm("message-cancelled-worker");
    const worker = new TuiTileWorker();
    worker.transferIn(osm.transferables());
    worker.cancelTilesBefore(4);

    await expect(worker.getStyledRasterTileCooperatively(osm.id, [0, 0, 0], 3)).resolves.toBeNull();
    await expect(
      worker.getStyledRasterTileCooperatively(osm.id, [0, 0, 0], 4),
    ).resolves.toBeInstanceOf(Uint8ClampedArray);
    worker.delete(osm.id);
  });

  it("services a cancellation update while a non-shared tile is rendering", async () => {
    const tile: Tile = [4_096, 4_096, 13];
    const osm = denselyIndexedOsm("yielded-message-cancel-worker", tile, 2_000);
    const worker = new TuiTileWorker();
    worker.transferIn(osm.transferables());
    setTimeout(() => worker.cancelTilesBefore(2), 0);

    await expect(worker.getStyledRasterTileCooperatively(osm.id, tile, 1)).resolves.toBeNull();
    worker.delete(osm.id);
  });

  it("returns dataset metadata rather than a main-thread Osm instance", async () => {
    const fixture = fileURLToPath(new URL("../../../fixtures/monaco.pbf", import.meta.url));
    const worker = new TuiTileWorker();
    const info = await worker.fromPbfFile(fixture, {
      id: "metadata-worker",
      buildSpatialIndexes: ["way", "relation"],
    });

    expect(info).toMatchObject({
      id: "metadata-worker",
      bbox: expect.arrayContaining([expect.any(Number)]),
      stats: {
        nodes: expect.any(Number),
        relations: expect.any(Number),
        ways: expect.any(Number),
      },
    });
    expect(info.stats.nodes).toBeGreaterThan(0);
    expect(info).not.toHaveProperty("nodes");
    worker.delete(info.id);
  });

  it("rejects runtimes without workers instead of falling back to local rendering", async () => {
    vi.stubGlobal("Worker", undefined);

    await expect(createStyledTileRenderer()).rejects.toThrow(
      "requires Web Worker support for non-blocking rendering",
    );
  });

  it("renders concurrently in Bun while the main-thread timer advances", async () => {
    const smokeTest = fileURLToPath(new URL("./worker-smoke.ts", import.meta.url));
    const { stdout } = await execFileAsync("bun", [smokeTest]);
    const lastLine = stdout.trim().split("\n").at(-1);
    const result = JSON.parse(lastLine ?? "null") as {
      byteLengths: number[];
      datasetId: string;
      datasetNodes: number;
      hardwareConcurrency: number;
      maxTimerLagMs: number;
      mode: string;
      progressEvents: number;
      timerTicks: number;
      workerCount: number;
    };

    expect(result.mode).toBe("workers");
    const totalWorkers = selectTileWorkerCount(result.hardwareConcurrency);
    expect(result.workerCount).toBe(totalWorkers > 1 ? totalWorkers - 1 : 1);
    expect(result.progressEvents).toBeGreaterThan(0);
    expect(result.datasetId).toBe("worker-smoke");
    expect(result.datasetNodes).toBeGreaterThan(0);
    expect(result.timerTicks).toBeGreaterThan(0);
    expect(result.maxTimerLagMs).toBeLessThan(250);
    expect(result.byteLengths).toEqual(Array(4).fill(256 * 256 * 4));
  }, 30_000);
});
