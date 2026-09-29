/** Vertical context (layer, level, bridge, tunnel, covered) and its comparisons. */
import type { OsmEntity, OsmTags } from "@osmix/types";

import { EXACT_NODE_ACCESS_TAGS } from "./access.ts";

function normalizedGradeValue(value: number | string | undefined, defaultValue: string) {
  const normalized = String(value ?? "");
  if (normalized === "" || normalized === "0" || normalized === "false" || normalized === "no") {
    return defaultValue;
  }
  return normalized;
}

/** Normalize the routing-relevant vertical context of a way for safe comparisons. */
export function routingGradeSignature(tags?: OsmTags) {
  return [
    `layer=${String(tags?.["layer"] ?? "0")}`,
    `level=${String(tags?.["level"] ?? "")}`,
    `bridge=${normalizedGradeValue(tags?.["bridge"], "no")}`,
    `tunnel=${normalizedGradeValue(tags?.["tunnel"], "no")}`,
    `covered=${normalizedGradeValue(tags?.["covered"], "no")}`,
  ].join("|");
}

const GRADE_TAG_DEFAULTS = {
  bridge: "no",
  covered: "no",
  layer: "0",
  level: "",
  tunnel: "no",
} as const;

export function hasConflictingGradeOrAccessTags(a: OsmEntity["tags"], b: OsmEntity["tags"]) {
  if (EXACT_NODE_ACCESS_TAGS.some((key) => String(a?.[key] ?? "") !== String(b?.[key] ?? ""))) {
    return true;
  }
  return Object.entries(GRADE_TAG_DEFAULTS).some(
    ([key, defaultValue]) => String(a?.[key] ?? defaultValue) !== String(b?.[key] ?? defaultValue),
  );
}
