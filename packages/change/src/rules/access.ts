/** Access and barrier keys, and the signatures merge stages compare. */
import type { OsmTags } from "@osmix/types";

// Access and routing checks also recognize namespaced variants (for example
// `access:conditional` and `maxspeed:forward`) so they cannot bypass review.
export const ROUTING_ACCESS_KEYS = [
  "access",
  "agricultural",
  "atv",
  "bicycle",
  "bus",
  "caravan",
  "carriage",
  "coach",
  "emergency",
  "foot",
  "forestry",
  "golf_cart",
  "goods",
  "horse",
  "hgv",
  "hgv_articulated",
  "hov",
  "inline_skates",
  "mofa",
  "moped",
  "motorcycle",
  "motor_vehicle",
  "motorcar",
  "motorhome",
  "psv",
  "ski",
  "snowmobile",
  "taxi",
  "tourist_bus",
  "trailer",
  "vehicle",
  "wheelchair",
] as const;

export function accessSignature(tags: OsmTags | undefined) {
  return Object.keys(tags ?? {})
    .filter((key) =>
      ROUTING_ACCESS_KEYS.some((accessKey) => key === accessKey || key.startsWith(`${accessKey}:`)),
    )
    .toSorted()
    .map((key) => `${key}=${String(tags?.[key] ?? "")}`)
    .join("|");
}

// These signatures intentionally compare both presence and value. Rewriting a
// patch reference must not strand node-level routing semantics on the discarded node.
export function barrierSignature(tags: OsmTags | undefined) {
  return Object.keys(tags ?? {})
    .filter((key) => key === "barrier" || key.startsWith("barrier:"))
    .toSorted()
    .map((key) => `${key}=${String(tags?.[key] ?? "")}`)
    .join("|");
}

/**
 * The narrower list exact reconciliation compares raw (no namespaces, `barrier` included).
 * Matching compares `ROUTING_ACCESS_KEYS` through `accessSignature` instead.
 */
export const EXACT_NODE_ACCESS_TAGS = [
  "access",
  "barrier",
  "bicycle",
  "foot",
  "horse",
  "motor_vehicle",
  "motorcar",
  "vehicle",
] as const;

/** Node tags that make an intersection survivor more important to keep. */
export const NODE_ROUTING_CRITICAL_TAGS = [
  "access",
  "barrier",
  "bicycle",
  "foot",
  "ford",
  "highway",
  "horse",
  "motor_vehicle",
  "motorcar",
  "vehicle",
] as const;
