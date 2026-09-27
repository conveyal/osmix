import { atomWithStorage } from "jotai/utils";
import { useSyncExternalStore } from "react";

export const sidebarIsOpenAtom = atomWithStorage("@osmix:layout:sidebarIsOpen", true);

/**
 * A DOM element that one component renders and another portals into. Not an atom: the owner
 * sets it from a ref during commit, before the reader's subscription exists, and only
 * `useSyncExternalStore` re-reads after subscribing (jotai 3's `useAtomValue` misses the set).
 */
function createElementAnchor() {
  let element: HTMLElement | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    /** The owner's ref callback. */
    set: (next: HTMLElement | null) => {
      element = next;
      for (const listener of listeners) listener();
    },
    /** The current element, or `null` while the owner is unmounted. */
    use: (): HTMLElement | null =>
      useSyncExternalStore(
        subscribe,
        () => element,
        () => null,
      ),
  };
}

const toastAnchor = createElementAnchor();
const navToolsAnchor = createElementAnchor();

/**
 * The element toasts render into: a strip across the top of `MapContent`, so the toast region
 * sits in the map's top-right corner. `null` (no `MapContent` mounted) falls back to the body.
 */
export const setToastAnchor = toastAnchor.set;
export const useToastAnchor = toastAnchor.use;

/**
 * The nav's map-tools slot, which `OsmixMap` portals its toolbar into. `null` until the nav
 * mounts.
 */
export const setNavToolsAnchor = navToolsAnchor.set;
export const useNavToolsAnchor = navToolsAnchor.use;
