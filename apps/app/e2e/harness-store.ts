import { useSyncExternalStore } from "react";

/**
 * Mutable session state for browser test harnesses.
 *
 * Harness sessions bundle workers, fixtures, and pending promise resolvers that tests poke at
 * directly. React state must stay immutable, so the session lives outside React as an external
 * store and components read it through `useHarnessSession`. Every `mutate`/`replace` notifies
 * subscribers so the harness re-renders after each change.
 */
export type HarnessStore<T> = {
  readonly current: T;
  mutate: (update: (session: T) => void) => void;
  replace: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => HarnessSnapshot<T>;
};

type HarnessSnapshot<T> = { session: T; revision: number };

export function createHarnessStore<T>(create: () => T): HarnessStore<T> {
  let snapshot: HarnessSnapshot<T> = { session: create(), revision: 0 };
  const listeners = new Set<() => void>();
  const notify = () => {
    snapshot = { session: snapshot.session, revision: snapshot.revision + 1 };
    for (const listener of listeners) listener();
  };
  return {
    get current() {
      return snapshot.session;
    },
    mutate: (update) => {
      update(snapshot.session);
      notify();
    },
    replace: (next) => {
      snapshot = { session: next, revision: snapshot.revision + 1 };
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
  };
}

/** Subscribe a harness component to the current session; re-renders after every mutation. */
export function useHarnessSession<T>(store: HarnessStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot).session;
}
