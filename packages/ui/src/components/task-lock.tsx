import { createContext, type ReactNode, useContext } from "react";

const TaskLockContext = createContext(false);

/**
 * Publishes whether a task is running. Only one runs at a time, so controls that start work
 * (every `ActionButton`, and others through `useTaskLock`) are disabled while it is set.
 */
export function TaskLockProvider({ locked, children }: { locked: boolean; children: ReactNode }) {
  return <TaskLockContext value={locked}>{children}</TaskLockContext>;
}

/** Whether a task is running and task-starting controls should be disabled. */
export function useTaskLock() {
  return useContext(TaskLockContext);
}
