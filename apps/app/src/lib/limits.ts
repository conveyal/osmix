/**
 * What Osmix can load, shared by Home's Limits section and the Limits page. The hard limits
 * come from the library; the file-size guidance comes from the measurements in
 * `docs/limits.md`.
 */
import {
  AUTO_LOAD_PROFILE_LIMITS,
  MAX_RELATION_MEMBERS,
  MAX_STRING_BYTES,
  MAX_WAY_REFS,
} from "osmix";

/** The full limits document, for readers who want every detail. */
export const LIMITS_DOC_URL = "https://github.com/conveyal/osmix/blob/main/docs/limits.md";

/** Home's short summary: what a typical user needs before opening a file. */
export const LIMITS_SUMMARY = [
  "Files up to about 500 MB load with every feature on a computer with 8 GB of memory or more.",
  "Files from 500 MB to about 1 GB load in View mode: the map, search and inspection work, but merge, routing and complete extracts are off.",
  "Larger files, such as Italy or the whole planet, do not load. Use Extract to cut a smaller region out of them first.",
  "Routing reads only the highway, oneway and maxspeed tags. It ignores turn restrictions and access tags.",
] as const;

/** File sizes and what to expect from each. */
export const FILE_SIZE_GUIDE = [
  {
    size: "Less than 100 MB",
    example: "A city or a small country",
    expect: "Loads in seconds with every feature.",
  },
  {
    size: "100 MB to 500 MB",
    example: "A large region or country",
    expect: "Loads with every feature on most computers with 8 GB of memory or more.",
  },
  {
    size: "500 MB to 1 GB",
    example: "Australia (908 MB)",
    expect: "Loads in View mode. Needs a computer with 16 GB of memory.",
  },
  {
    size: "More than 1 GB",
    example: "Italy (2.2 GB), the planet",
    expect: "Does not load. Cut a smaller region out with Extract.",
  },
] as const;

/** Rules of thumb for estimating memory from a PBF file size. */
export const MEMORY_RULES = [
  "Memory in use after a load is about 5× the PBF file size.",
  "Memory at the peak of a load is about 6× to 7× the PBF file size.",
  "Saving a dataset in browser storage uses about 4× the PBF file size of disk quota.",
  "The routing graph adds between 0.3× and 2× the PBF file size. Areas with many roads are at the high end.",
  "Chrome and Edge give the best results for large files: they share memory between workers and save straight to disk.",
] as const;

const MIB = 2 ** 20;
const GIB = 2 ** 30;

/** How Auto chooses between Full and View, from the thresholds the loader uses. */
export const AUTO_PROFILE_RULES = [
  `The all-node index is at most ${AUTO_LOAD_PROFILE_LIMITS.allNodeSpatialIndexBytes / MIB} MiB, which is about ${Math.floor(AUTO_LOAD_PROFILE_LIMITS.allNodeSpatialIndexBytes / 4 / 1e6)} million nodes.`,
  `The projected memory peak is below ${AUTO_LOAD_PROFILE_LIMITS.typedArrayPeakBytes / GIB} GiB and below ${AUTO_LOAD_PROFILE_LIMITS.deviceMemoryFraction * 100}% of the device memory that the browser reports (browsers report at most 8 GB).`,
  `Each allocation is below ${AUTO_LOAD_PROFILE_LIMITS.bufferHeadroomFraction * 100}% of the largest buffer that Check system measured.`,
] as const;

/** What the router does not model. */
export const ROUTER_LIMITS = [
  "Turn restrictions",
  "Access tags (access, motor_vehicle, foot, bicycle and more)",
  "One-way rules for one mode only (oneway:bicycle, oneway:foot), conditional rules and lane rules",
  "Turn costs and elevation",
  "A bicycle profile: the walking network includes cycleways",
  "Snapping to a point along a road: a route starts and ends at the nearest node",
] as const;

/** Hard limits of the storage layout, for advanced users. */
export const DATA_LIMITS = [
  { limit: "Node refs in one way", value: MAX_WAY_REFS.toLocaleString("en-US") },
  { limit: "Members in one relation", value: MAX_RELATION_MEMBERS.toLocaleString("en-US") },
  {
    limit: "UTF-8 bytes in one tag value or role",
    value: MAX_STRING_BYTES.toLocaleString("en-US"),
  },
  { limit: "Nodes, ways or relations (with 2 GiB buffers)", value: "About 268 million each" },
  { limit: "Unique strings (tag keys, values, roles)", value: "About 16.7 million" },
  { limit: "Coordinate precision", value: "1e-7 degrees (about 1 cm)" },
] as const;

/** Measured memory use, from `docs/limits.md`. */
export const MEASUREMENTS = [
  { fixture: "Spokane", pbf: "9 MiB", nodes: "1.2 million", memory: "52 MiB", routing: "9 MiB" },
  { fixture: "Seattle", pbf: "28 MiB", nodes: "2.7 million", memory: "143 MiB", routing: "62 MiB" },
  {
    fixture: "Montenegro",
    pbf: "29 MiB",
    nodes: "3.9 million",
    memory: "133 MiB",
    routing: "47 MiB",
  },
  {
    fixture: "Australia",
    pbf: "909 MiB",
    nodes: "134 million",
    memory: "4,844 MiB",
    routing: "1,023 MiB",
  },
  {
    fixture: "Italy (Node only)",
    pbf: "2,109 MiB",
    nodes: "274 million",
    memory: "10,539 MiB",
    routing: "2,031 MiB",
  },
] as const;
