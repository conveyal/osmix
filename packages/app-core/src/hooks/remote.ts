import { useAtomValue } from "jotai";

import type { OsmixAppRemote } from "../remote.ts";
import { remoteAtom } from "../state/remote.ts";

/** The app's worker remote, as set on the jotai store at bootstrap. */
export function useOsmixRemote(): OsmixAppRemote {
  return useAtomValue(remoteAtom);
}
