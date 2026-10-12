import { useEffect, useEffectEvent, useState } from "react";

export type WorkerPageState<T> = { page: T; error?: never } | { page?: never; error: string };

/**
 * A page of results the worker returns, loaded again whenever `key` changes. `null` while the
 * page for the current key is loading; a failure is kept as its message, not thrown.
 */
export function useWorkerPage<T>(key: string, load: () => Promise<T>): WorkerPageState<T> | null {
  const [state, setState] = useState<(WorkerPageState<T> & { key: string }) | null>(null);
  const loadPage = useEffectEvent(load);
  useEffect(() => {
    let live = true;
    loadPage().then(
      (page) => {
        if (live) setState({ key, page });
      },
      (error: unknown) => {
        if (live) setState({ key, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [key]);
  if (state?.key !== key) return null;
  return state.error === undefined ? { page: state.page as T } : { error: state.error };
}
