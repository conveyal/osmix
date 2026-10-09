/** Tag comparisons shared by every merge stage. */
import type { OsmEntity } from "@osmix/types";
import { normalizedWayDirection } from "@osmix/types/way-direction";

const DESCRIPTIVE_WAY_TAGS = new Set([
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

const DESCRIPTIVE_WAY_TAG_PREFIXES = [
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

/**
 * The imported tags a merge may write into base data (MP-X4): an import's own keys can be left
 * out, so they reach the result only on features the import adds.
 */
export type ImportedTags = (tags: OsmEntity["tags"]) => OsmEntity["tags"];

/** Keep every imported key. */
export const keepImportedTags: ImportedTags = (tags) => tags;

/**
 * Leave out the imported keys `patterns` name: each is a key, or a prefix ending in `*`
 * (`ext:*`). Tags with none of them are returned as they are.
 */
export function droppingImportedKeys(patterns: readonly string[] = []): ImportedTags {
  for (const pattern of patterns) {
    const star = pattern.indexOf("*");
    if (pattern === "" || pattern === "*" || (star !== -1 && star !== pattern.length - 1)) {
      throw Error(`dropImportedKeys entry "${pattern}" must be a key or a prefix ending in *`);
    }
  }
  if (patterns.length === 0) return keepImportedTags;
  const keys = new Set(patterns.filter((pattern) => !pattern.endsWith("*")));
  const prefixes = patterns.filter((pattern) => pattern.endsWith("*")).map((p) => p.slice(0, -1));
  const dropped = (key: string) => keys.has(key) || prefixes.some((p) => key.startsWith(p));
  return (tags) => {
    if (!tags || !Object.keys(tags).some(dropped)) return tags;
    return Object.fromEntries(Object.entries(tags).filter(([key]) => !dropped(key)));
  };
}

/** The keys `a` and `b` both set, to different values, in key order. */
export function conflictingTagKeys(a: OsmEntity["tags"], b: OsmEntity["tags"]) {
  if (!a || !b) return [];
  return Object.keys(a)
    .filter((key) => b[key] != null && b[key] !== a[key])
    .toSorted();
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

/**
 * An imported way's tags merged into a base way's (MP-X2): the imported values win and base-only
 * keys stay. Direction is compared normalized (MP-X3), so an equivalent `oneway` spelling keeps
 * the base's.
 */
export function mergeImportedWayTags(base: OsmEntity["tags"], imported: OsmEntity["tags"]) {
  const tags = { ...base, ...imported };
  if (normalizedWayDirection(base) === normalizedWayDirection(imported)) {
    if (base?.["oneway"] === undefined) delete tags["oneway"];
    else tags["oneway"] = base["oneway"];
  }
  return tags;
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
