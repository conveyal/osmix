/**
 * What to expect from loading a PBF of a given size, before the load starts. The ratios come from
 * the measurements in `docs/limits.md`: a loaded dataset uses about 5× its PBF size, and a load
 * peaks at about 6× (View) to 7× (Full).
 */
import type { OsmFileType } from "osmix";

/** PBF size up to which Full usually fits: about 67 million nodes, the Auto all-node limit. */
export const FULL_PROFILE_MAX_PBF_BYTES = 500_000_000;

/** PBF size above which a browser usually cannot load the file at all. */
export const BROWSER_MAX_PBF_BYTES = 1_000_000_000;

/** Projected typed-array peak for Full and for View, as a multiple of the PBF size. */
const FULL_PEAK_RATIO = 7;
const VIEW_PEAK_RATIO = 6;

/** Share of the reported device memory that Auto lets a Full load use. */
const DEVICE_MEMORY_FRACTION = 0.4;

/** The expected outcome of loading a PBF: every feature, View only, or likely failure. */
export type OsmFileSizeGuidance =
  | { level: "full" }
  | { level: "view" | "too-large"; title: string; detail: string };

/** Whether a file that is about to load is a PBF, from its chosen type or its name. */
export function isPbfFile(file: File, fileType?: OsmFileType): boolean {
  return fileType === "pbf" || (fileType === undefined && /\.pbf$/i.test(file.name));
}

/**
 * Estimate, from its size, how a PBF will load. `deviceMemoryBytes` is the browser's reported
 * memory class (`navigator.deviceMemory`, at most 8 GiB), when it has one.
 */
export function osmFileSizeGuidance(
  pbfBytes: number,
  deviceMemoryBytes?: number,
): OsmFileSizeGuidance {
  const size = formatDecimalBytes(pbfBytes);
  const peak = formatDecimalBytes(pbfBytes * VIEW_PEAK_RATIO);
  const tooLargeForDevice =
    deviceMemoryBytes !== undefined && pbfBytes * VIEW_PEAK_RATIO > deviceMemoryBytes;
  if (pbfBytes > BROWSER_MAX_PBF_BYTES || tooLargeForDevice) {
    return {
      level: "too-large",
      title: "This file is probably too large to load",
      detail: `A ${size} PBF needs about ${peak} of memory to load, more than the browser is likely to give. Cut a smaller region out of it with Extract, which reads the file without loading it.`,
    };
  }
  const fullFitsDevice =
    deviceMemoryBytes === undefined ||
    pbfBytes * FULL_PEAK_RATIO <= deviceMemoryBytes * DEVICE_MEMORY_FRACTION;
  if (pbfBytes > FULL_PROFILE_MAX_PBF_BYTES || !fullFitsDevice) {
    return {
      level: "view",
      title: "This file will probably load in View mode",
      detail: `A ${size} PBF is more than Full mode fits in this browser. The map, search and inspection will work, but merge, routing and complete extracts will not. To keep every feature, cut a smaller region out of it with Extract.`,
    };
  }
  return { level: "full" };
}

/** "480 MB", "2.2 GB": decimal units, as file managers show file sizes. */
function formatDecimalBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
