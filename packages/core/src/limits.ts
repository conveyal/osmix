/**
 * Hard capacity limits set by the typed-array layout of `Osm` storage.
 *
 * See `docs/limits.md` for the full list, including limits that come from the
 * JavaScript engine rather than from this layout.
 */

/** Largest number of node refs one way can hold (`Ways.refCount` is a `Uint16Array`). */
export const MAX_WAY_REFS = 0xffff;

/** Largest number of members one relation can hold (`Relations.memberCount` is a `Uint16Array`). */
export const MAX_RELATION_MEMBERS = 0xffff;

/** Largest UTF-8 byte length of one string (`StringTable.count` is a `Uint16Array`). */
export const MAX_STRING_BYTES = 0xffff;

/**
 * Largest element offset a `Uint32Array` offset column can store. Bounds the total
 * way refs, relation members and string-table bytes in one dataset.
 */
export const MAX_UINT32_OFFSET = 0xffffffff;

/** The storage limit an {@link OsmCapacityError} reports. */
export type OsmCapacityLimit =
  | "way-refs"
  | "relation-members"
  | "string-bytes"
  | "total-way-refs"
  | "total-relation-members"
  | "total-string-bytes";

/** Thrown when an entity or dataset is larger than the storage layout can hold. */
export class OsmCapacityError extends Error {
  readonly code = "OSM_CAPACITY_EXCEEDED";
  readonly limit: OsmCapacityLimit;
  readonly value: number;
  readonly max: number;

  constructor(limit: OsmCapacityLimit, value: number, max: number, subject: string) {
    super(
      `${subject} has ${value.toLocaleString("en-US")} ${capacityUnit(limit)}; ` +
        `Osmix stores at most ${max.toLocaleString("en-US")}.`,
    );
    this.name = "OsmCapacityError";
    this.limit = limit;
    this.value = value;
    this.max = max;
  }
}

function capacityUnit(limit: OsmCapacityLimit): string {
  switch (limit) {
    case "way-refs":
    case "total-way-refs":
      return "node refs";
    case "relation-members":
    case "total-relation-members":
      return "members";
    case "string-bytes":
    case "total-string-bytes":
      return "UTF-8 bytes";
  }
}

/** Throw {@link OsmCapacityError} when `value` is above `max`. */
export function assertCapacity(
  limit: OsmCapacityLimit,
  value: number,
  max: number,
  subject: () => string,
): void {
  if (value > max) throw new OsmCapacityError(limit, value, max, subject());
}
