import { useOsmFile } from "@osmix/app-core";

import { BASE_OSM_KEY, PATCH_OSM_KEY } from "../settings";

/** Merge's base input. It never holds the patch's file. Use this, not `useOsmFile`, for it. */
export function useBaseOsm() {
  return useOsmFile(BASE_OSM_KEY, { distinctFrom: { osmKey: PATCH_OSM_KEY, label: "Patch" } });
}

/** Merge's patch input. It never holds the base's file. Use this, not `useOsmFile`, for it. */
export function usePatchOsm() {
  return useOsmFile(PATCH_OSM_KEY, { distinctFrom: { osmKey: BASE_OSM_KEY, label: "Base" } });
}
