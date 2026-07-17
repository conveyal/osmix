import { afterEach, describe, expect, it, vi } from "vitest";

describe("without SharedArrayBuffer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("builds indexes and manages ArrayBuffer-backed typed arrays", async () => {
    vi.stubGlobal("SharedArrayBuffer", undefined);
    vi.resetModules();

    const { BufferConstructor, ResizeableTypedArray } = await import("../src/typed-arrays.ts");
    const { Osm } = await import("../src/osm.ts");

    expect(BufferConstructor).toBe(ArrayBuffer);

    const osm = new Osm({ id: "array-buffer-only" });
    osm.nodes.addNode({ id: 1, lon: 115.2167, lat: -8.65, tags: { place: "city" } });
    osm.nodes.addNode({ id: 2, lon: 115.22, lat: -8.66 });
    osm.ways.addWay({ id: 1, refs: [1, 2], tags: { highway: "residential" } });
    osm.buildIndexes();

    expect(osm.isReady()).toBe(true);
    expect(osm.nodes.getById(1)?.tags?.["place"]).toBe("city");

    const restored = ResizeableTypedArray.from(Uint8Array, new ArrayBuffer(4));
    expect(restored.BC).toBe(ArrayBuffer);

    const growing = new ResizeableTypedArray(Uint8Array);
    growing.items = growing.array.length;
    growing.push(7);
    expect(growing.buffer).toBeInstanceOf(ArrayBuffer);
    expect(growing.at(-1)).toBe(7);

    const compacted = growing.compact();
    expect(compacted.buffer).toBeInstanceOf(ArrayBuffer);
    expect(compacted.length).toBe(growing.length);
  });
});
