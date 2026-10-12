import { describe, expect, it } from "vitest";

import { isPbfFile, osmFileSizeGuidance } from "../src/lib/file-size-guidance.ts";

const GiB = 2 ** 30;

describe("osmFileSizeGuidance", () => {
  it("expects every feature for a small file", () => {
    expect(osmFileSizeGuidance(30_000_000, 8 * GiB)).toEqual({ level: "full" });
    expect(osmFileSizeGuidance(30_000_000)).toEqual({ level: "full" });
  });

  it("expects View above the Full size limit", () => {
    // Australia: 952,642,672 bytes, which loaded in View on a 16 GB machine.
    const guidance = osmFileSizeGuidance(952_642_672, 8 * GiB);
    expect(guidance.level).toBe("view");
    expect(guidance).toMatchObject({ detail: expect.stringContaining("953 MB") });
  });

  it("expects View when Full does not fit a small reported memory", () => {
    // 7 × 200 MB = 1.4 GB is more than 40% of 2 GiB.
    expect(osmFileSizeGuidance(200_000_000, 2 * GiB).level).toBe("view");
    expect(osmFileSizeGuidance(200_000_000, 8 * GiB).level).toBe("full");
  });

  it("expects failure above the browser limit or the reported memory", () => {
    // Italy: 2.2 GB.
    const guidance = osmFileSizeGuidance(2_211_033_554, 8 * GiB);
    expect(guidance).toMatchObject({ level: "too-large" });
    expect(guidance).toMatchObject({ detail: expect.stringContaining("2.2 GB PBF") });
    // 6 × 800 MB = 4.8 GB is more than 4 GiB.
    expect(osmFileSizeGuidance(800_000_000, 4 * GiB).level).toBe("too-large");
    expect(osmFileSizeGuidance(800_000_000, 8 * GiB).level).toBe("view");
  });
});

describe("isPbfFile", () => {
  it("uses the chosen type, or the name when no type was chosen", () => {
    expect(isPbfFile(new File([], "region.osm.pbf"))).toBe(true);
    expect(isPbfFile(new File([], "region.bin"), "pbf")).toBe(true);
    expect(isPbfFile(new File([], "region.pbf"), "geojson")).toBe(false);
    expect(isPbfFile(new File([], "region.geojson"))).toBe(false);
  });
});
