import { atomWithStorage } from "jotai/utils";
import { useSyncExternalStore } from "react";

export const sidebarIsOpenAtom = atomWithStorage("@osmix:layout:sidebarIsOpen", true);

/**
 * The element toasts render into: a strip across the top of `MapContent`, so the toast region
 * centres on the map beside the sidebar. `null` (no `MapContent` mounted) falls back to the body.
 * Not an atom: `MapContent` sets it from a ref during commit, before the `Toaster`'s subscription
 * exists, and only `useSyncExternalStore` re-reads after subscribing.
 */
let toastAnchor: HTMLElement | null = null;
const toastAnchorListeners = new Set<() => void>();

/** `MapContent`'s ref callback for the toast anchor. */
export function setToastAnchor(element: HTMLElement | null) {
  toastAnchor = element;
  for (const listener of toastAnchorListeners) listener();
}

function subscribeToastAnchor(listener: () => void) {
  toastAnchorListeners.add(listener);
  return () => {
    toastAnchorListeners.delete(listener);
  };
}

/** The current toast anchor, or `null` when no `MapContent` is mounted. */
export function useToastAnchor(): HTMLElement | null {
  return useSyncExternalStore(
    subscribeToastAnchor,
    () => toastAnchor,
    () => null,
  );
}
