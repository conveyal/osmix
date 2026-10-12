import { useSyncExternalStore } from "react";

import { Tasks, type TasksSnapshot } from "../state/tasks.ts";

/** Subscribe to the shared activity history and the open task. */
export function useTasks(): TasksSnapshot {
  return useSyncExternalStore(Tasks.subscribe, Tasks.getSnapshot);
}
