import { useSyncExternalStore } from "react";

import { Log } from "../state/log.ts";

export function useLog() {
  return useSyncExternalStore(Log.subscribe, Log.getSnapshot);
}
