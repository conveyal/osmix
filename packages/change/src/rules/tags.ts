/** Tag comparisons shared by every merge stage. */
import type { OsmEntity } from "@osmix/types";
import { normalizedWayDirection } from "@osmix/types/way-direction";

export const DESCRIPTIVE_WAY_TAGS = new Set([
  "alt_name",
  "int_name",
  "loc_name",
  "name",
  "note",
  "official_name",
  "old_name",
  "operator",
  "ref",
  "short_name",
  "source",
  "wikidata",
  "wikipedia",
]);

export const DESCRIPTIVE_WAY_TAG_PREFIXES = [
  "alt_name:",
  "name:",
  "note:",
  "official_name:",
  "old_name:",
  "operator:",
  "source:",
] as const;

export function hasAnyTagConflict(a: OsmEntity["tags"], b: OsmEntity["tags"]) {
  if (!a || !b) return false;
  return Object.entries(a).some(([key, value]) => b[key] != null && b[key] !== value);
}

export function isDescriptiveWayTag(key: string) {
  return (
    DESCRIPTIVE_WAY_TAGS.has(key) ||
    DESCRIPTIVE_WAY_TAG_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

export function routingSemanticTagsEqual(a: OsmEntity["tags"], b: OsmEntity["tags"]) {
  const direction = normalizedWayDirection(a);
  if (direction === "unsupported" || direction !== normalizedWayDirection(b)) return false;
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].every(
    (key) => key === "oneway" || isDescriptiveWayTag(key) || a?.[key] === b?.[key],
  );
}

export function withNonConflictingTags<T extends OsmEntity>(base: T, patch: T): T {
  if (!patch.tags) return base;
  const tags = { ...base.tags };
  let changed = false;
  for (const [key, value] of Object.entries(patch.tags)) {
    if (tags[key] != null) continue;
    tags[key] = value;
    changed = true;
  }
  return changed ? { ...base, tags } : base;
}

export function withNonConflictingDescriptiveTags<T extends OsmEntity>(base: T, patch: T): T {
  if (!patch.tags) return base;
  const tags = { ...base.tags };
  let changed = false;
  for (const [key, value] of Object.entries(patch.tags)) {
    if (!isDescriptiveWayTag(key) || tags[key] != null) continue;
    tags[key] = value;
    changed = true;
  }
  return changed ? { ...base, tags } : base;
}
