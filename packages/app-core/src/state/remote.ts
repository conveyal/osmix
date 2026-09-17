import { atom } from "jotai";

import type { OsmixAppRemote } from "../remote.ts";

const remoteBaseAtom = atom<OsmixAppRemote | null>(null);

/**
 * The app's worker remote. Each app creates one with `createOsmixAppRemote()` and sets it on
 * its jotai store during bootstrap; atoms and hooks read it from here instead of importing a
 * module-level singleton. Reading before it is set is a programming error and throws.
 */
export const remoteAtom = atom(
  (get) => {
    const remote = get(remoteBaseAtom);
    if (!remote) {
      throw new Error(
        "OsmixAppRemote is not set. Call store.set(remoteAtom, remote) before rendering.",
      );
    }
    return remote;
  },
  (_get, set, remote: OsmixAppRemote) => set(remoteBaseAtom, remote),
);
