/**
 * The worker ID of the dataset a slot holds. Each slot (`base`, `patch`, `inspect`, ...) owns a
 * private worker ID, so a file open in two slots is two registrations over the same shared
 * buffers: a merge or applied fixes that replace one slot's dataset never change another's, and
 * a slot frees its dataset without checking who else uses it. `key` is the file or content hash
 * that also keys browser storage.
 */
export function slotOsmId(osmKey: string, key: string): string {
  if (key === "") throw Error("A slot dataset needs a file key.");
  return `${slotOsmIdPrefix(osmKey)}${key}`;
}

/** The prefix of every worker ID `slotOsmId` gives the slot, for loaders that learn the key late. */
export function slotOsmIdPrefix(osmKey: string): string {
  if (osmKey === "") throw Error("A slot dataset needs a slot key.");
  return `${osmKey}-`;
}
