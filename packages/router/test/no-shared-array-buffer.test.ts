import { afterEach, describe, expect, it, vi } from "vitest";

describe("router transfers without SharedArrayBuffer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns every ArrayBuffer in the transfer list", async () => {
    vi.stubGlobal("SharedArrayBuffer", undefined);
    vi.resetModules();

    const { getTransferableBuffers } = await import("../src/graph.ts");
    const createBuffer = () => new ArrayBuffer(4);
    const transferables = {
      nodeCount: 0,
      edgeCount: 0,
      edgeOffsets: createBuffer(),
      edgeTargets: createBuffer(),
      edgeWayIndexes: createBuffer(),
      edgeDistances: createBuffer(),
      edgeTimes: createBuffer(),
      routableBits: createBuffer(),
      intersectionBits: createBuffer(),
    };

    expect(getTransferableBuffers(transferables)).toEqual([
      transferables.edgeOffsets,
      transferables.edgeTargets,
      transferables.edgeWayIndexes,
      transferables.edgeDistances,
      transferables.edgeTimes,
      transferables.routableBits,
      transferables.intersectionBits,
    ]);
  });
});
