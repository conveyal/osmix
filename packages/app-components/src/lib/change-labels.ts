import type { OsmChange, OsmChangeTypes, OsmEntity, OsmEntityType } from "osmix";
import { getEntityType, isNode, isRelation, isWay } from "osmix";

/** Sentence-case entity type ("Node"), for titles. */
export function entityTypeLabel(type: OsmEntityType): string {
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

/** Sentence-case type name and ID for a title: "Node 2066450". */
export function entityTitle(entity: OsmEntity): string {
  return `${entityTypeLabel(getEntityType(entity))} ${entity.id}`;
}

/** Sentence-case change type: "Delete". */
export function changeTypeLabel(changeType: OsmChangeTypes): string {
  return `${changeType.charAt(0).toUpperCase()}${changeType.slice(1)}`;
}

/** Tags that say what a feature is, in the order a reader looks for them. */
const DESCRIPTIVE_KEYS = [
  "highway",
  "building",
  "amenity",
  "barrier",
  "crossing",
  "railway",
  "public_transport",
  "natural",
  "landuse",
  "type",
];

/** One short hint at what an entity is: its name, else its main tag, else "untagged". */
export function entityTagHint(entity: OsmEntity): string {
  const tags = entity.tags;
  if (!tags || Object.keys(tags).length === 0) return "untagged";
  if (typeof tags["name"] === "string" && tags["name"]) return tags["name"];
  const key = DESCRIPTIVE_KEYS.find((candidate) => tags[candidate] !== undefined);
  if (key) return `${key}=${String(tags[key])}`;
  const [first] = Object.keys(tags).sort();
  return `${first}=${String(tags[first])}`;
}

function sameTags(a: OsmEntity, b: OsmEntity): boolean {
  const aTags = a.tags ?? {};
  const bTags = b.tags ?? {};
  const keys = new Set([...Object.keys(aTags), ...Object.keys(bTags)]);
  for (const key of keys) if (aTags[key] !== bTags[key]) return false;
  return true;
}

function plural(count: number, noun: string) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/** What a modification changed, from the old and new entity. */
function modificationSummary(oldEntity: OsmEntity, entity: OsmEntity): string {
  const parts: string[] = [];
  if (isWay(oldEntity) && isWay(entity)) {
    const kept = new Set(entity.refs);
    const rewritten = oldEntity.refs.filter((ref) => !kept.has(ref)).length;
    if (rewritten > 0) parts.push(`${plural(rewritten, "node reference")} rewritten`);
  } else if (isRelation(oldEntity) && isRelation(entity)) {
    const key = (m: (typeof entity.members)[number]) => `${m.type}:${m.ref}:${m.role ?? ""}`;
    const kept = new Set(entity.members.map(key));
    const rewritten = oldEntity.members.filter((member) => !kept.has(key(member))).length;
    if (rewritten > 0) parts.push(`${plural(rewritten, "member")} rewritten`);
  } else if (isNode(oldEntity) && isNode(entity)) {
    if (oldEntity.lon !== entity.lon || oldEntity.lat !== entity.lat) parts.push("Moved");
  }
  if (!sameTags(oldEntity, entity)) parts.push(parts.length > 0 ? "tags changed" : "Tags changed");
  return parts.length > 0 ? parts.join(", ") : "Changed";
}

/**
 * The second line of a change row: what the change relates to, then a tag hint. A deleted
 * duplicate names the entity that replaces it ("Duplicate of node 2066452" when `duplicates`,
 * else "Replaced by …"); a modification says what it rewrote.
 */
export function changeDescription(change: OsmChange, { duplicates = false } = {}): string {
  const { changeType, entity, oldEntity, refs } = change;
  const related = refs?.map((ref) => `${ref.type} ${ref.id}`).join(", ");
  let what: string;
  if (changeType === "delete") {
    what = related ? `${duplicates ? "Duplicate of" : "Replaced by"} ${related}` : "Removed";
  } else if (changeType === "modify") {
    what = oldEntity ? modificationSummary(oldEntity, entity) : "Changed";
  } else {
    what = "New";
  }
  return `${what} · ${entityTagHint(oldEntity ?? entity)}`;
}
