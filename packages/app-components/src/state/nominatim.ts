import { atom } from "jotai";

import type { NominatimResult } from "../components/nominatim-search-control.tsx";

/**
 * The place most recently chosen in any `NominatimSearch` (the map search panel or an embedded
 * search box). `null` until a place is chosen. Apps subscribe to follow the searched place, for
 * example to move an extract bbox.
 */
export const nominatimPlaceAtom = atom<NominatimResult | null>(null);
