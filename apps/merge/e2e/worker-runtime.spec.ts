import { expect, test } from "@playwright/test";

interface Counts {
  nodes: number;
  ways: number;
  relations: number;
}

interface SingleWorkerResult {
  mode: string;
  workerCount: number;
  counts: Counts;
  vectorByteLength: number;
  rasterByteLength: number;
  rasterHasNontransparentPixel: boolean;
}

interface MultiWorkerResult {
  crossOriginIsolated: boolean;
  mode: string;
  workerCount: number;
  nodeCounts: number[];
  wayCounts: number[];
  relationCounts: number[];
  vectorByteLengths: number[];
}

interface SingleWorkerTransferResult {
  mode: string;
  workerCount: number;
  counts: Counts;
}

interface DisposeResult {
  releasedProxyError: boolean;
  workerCount: number;
  completedCycles: number;
}

interface ReservedIdsResult {
  mode: string;
  workerCount: number;
  ids: string[];
  beforeDelete: boolean[];
  afterDelete: boolean[];
  survivorNodeCounts: number[];
}

declare global {
  interface Window {
    workerHarness: {
      runDispose: () => Promise<DisposeResult>;
      runSingleWorker: () => Promise<SingleWorkerResult>;
      runSingleWorkerTransfer: () => Promise<SingleWorkerTransferResult>;
      runMultiWorker: () => Promise<MultiWorkerResult>;
      runReservedIds: (workerCount: number) => Promise<ReservedIdsResult>;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/worker-harness.html");
});

test("single worker loads Monaco and renders occupied tiles", async ({ page }) => {
  const result = await page.evaluate(() => window.workerHarness.runSingleWorker());

  expect(result.mode).toBe("single-worker");
  expect(result.workerCount).toBe(1);
  expect(result.counts).toEqual({ nodes: 14_286, ways: 3_346, relations: 46 });
  expect(result.vectorByteLength).toBeGreaterThan(0);
  expect(result.rasterByteLength).toBe(64 * 64 * 4);
  expect(result.rasterHasNontransparentPixel).toBe(true);
});

test("multi-worker replicates Monaco in a cross-origin isolated page", async ({ page }) => {
  const result = await page.evaluate(() => window.workerHarness.runMultiWorker());

  expect(result.crossOriginIsolated).toBe(true);
  expect(result.mode).toBe("multi-worker");
  expect(result.workerCount).toBe(2);
  expect(result.nodeCounts).toEqual([14_286, 14_286]);
  expect(result.wayCounts).toEqual([3_346, 3_346]);
  expect(result.relationCounts).toEqual([46, 46]);
  expect(result.vectorByteLengths).toHaveLength(2);
  expect(result.vectorByteLengths.every((length) => length > 0)).toBe(true);
});

test("single worker transfers sorted Monaco IDs without cloning errors", async ({ page }) => {
  const result = await page.evaluate(() => window.workerHarness.runSingleWorkerTransfer());

  expect(result.mode).toBe("single-worker");
  expect(result.workerCount).toBe(1);
  expect(result.counts).toEqual({ nodes: 14_286, ways: 3_346, relations: 46 });
});

test("single worker isolates reserved dataset IDs and cleanup", async ({ page }) => {
  const result = await page.evaluate(() => window.workerHarness.runReservedIds(1));

  expect(result.mode).toBe("single-worker");
  expect(result.workerCount).toBe(1);
  expect(result.ids).toEqual(["__proto__", "constructor", "toString", "ordinary"]);
  expect(result.beforeDelete).toEqual([true, true, true, true]);
  expect(result.afterDelete).toEqual([true, false, true, true]);
  expect(result.survivorNodeCounts).toEqual([14_286, 0, 14_286, 14_286]);
});

test("multi-worker isolates reserved dataset IDs and cleanup", async ({ page }) => {
  const result = await page.evaluate(() => window.workerHarness.runReservedIds(2));

  expect(result.mode).toBe("multi-worker");
  expect(result.workerCount).toBe(2);
  expect(result.beforeDelete).toEqual([true, true, true, true]);
  expect(result.afterDelete).toEqual([true, false, true, true]);
  expect(result.survivorNodeCounts).toEqual([14_286, 0, 14_286, 14_286]);
});

test("disposes workers and completes repeated create/dispose cycles", async ({ page }) => {
  const result = await page.evaluate(() => window.workerHarness.runDispose());

  expect(result.releasedProxyError).toBe(true);
  expect(result.workerCount).toBe(0);
  expect(result.completedCycles).toBe(3);
});
