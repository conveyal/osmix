import type { OsmTags } from "@osmix/types";

import type { OsmConflationFeatureTypeConflict } from "../types.ts";

// Compare shared classification keys, not names or missing information. These
// keys describe independent facets; different keys can coexist on one feature.
// Routing classifications retain their existing context-specific rules.
const FEATURE_CLASSIFICATION_KEYS = [
  "aeroway",
  "amenity",
  "boundary",
  "building",
  "craft",
  "emergency",
  "healthcare",
  "historic",
  "landuse",
  "leisure",
  "man_made",
  "natural",
  "office",
  "place",
  "power",
  "public_transport",
  "railway",
  "shop",
  "tourism",
] as const;

/** A missing subtype cannot establish a conflict or prove feature identity. */
export function featureTypeConflicts(
  patchTags: OsmTags | undefined,
  baseTags: OsmTags | undefined,
): OsmConflationFeatureTypeConflict[] {
  const conflicts: OsmConflationFeatureTypeConflict[] = [];
  for (const key of FEATURE_CLASSIFICATION_KEYS) {
    const patchValue = patchTags?.[key];
    const baseValue = baseTags?.[key];
    if (patchValue == null || baseValue == null) continue;
    const patchType = String(patchValue).trim();
    const baseType = String(baseValue).trim();
    if (!patchType || !baseType || patchType === baseType) continue;
    // `yes` supplies no subtype, but it still contradicts explicit absence.
    if ((patchType === "yes" || baseType === "yes") && patchType !== "no" && baseType !== "no")
      continue;
    conflicts.push({ key, baseValue, patchValue });
  }
  return conflicts;
}
