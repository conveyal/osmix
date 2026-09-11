import type { OsmTags } from "./types.ts";

/** Travel direction relative to a way's ordered node references. */
export type OsmWayDirection = "forward" | "reverse" | "both" | "unsupported";

/**
 * Normalize supported static one-way tags, including the implicit roundabout direction.
 * Unknown nonempty values require richer routing rules and cannot establish equivalence.
 */
export function normalizedWayDirection(tags: OsmTags | undefined): OsmWayDirection {
  const value = String(tags?.["oneway"] ?? "").toLowerCase();
  if (value === "yes" || value === "true" || value === "1") return "forward";
  if (value === "reverse" || value === "-1") return "reverse";
  if (value === "no" || value === "false" || value === "0") return "both";
  if (value !== "") return "unsupported";
  return tags?.["junction"] === "roundabout" ? "forward" : "both";
}
