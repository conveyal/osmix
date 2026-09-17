import { atom } from "jotai";
import { atomFamily } from "jotai-family";

/**
 * Increments every time the dataset in an osm slot is replaced or cleared by `useOsmFile`.
 * Apps derive invalidation from it (for example, resetting a merge outcome when an input
 * changes) without the shared loader knowing about app-specific state.
 */
export const osmDatasetVersionAtomFamily = atomFamily((_key: string) => atom(0));
