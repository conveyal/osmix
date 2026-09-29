import type { BitSet } from "@osmix/shared/bit-set";

/** Indexes of the set bits, ordered by the entity ID at each index. */
export function sortedIndexes(set: BitSet, ids: { at(index: number): number }): Uint32Array {
  const indexes = new Uint32Array(set.count);
  let position = 0;
  set.forEach((index) => {
    indexes[position++] = index;
  });
  return indexes.sort((a, b) => ids.at(a) - ids.at(b));
}
