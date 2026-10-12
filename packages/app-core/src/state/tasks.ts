/**
 * The activity model shared by every Osmix app: a history of top-level Tasks, each holding Steps
 * and messages. Only one top-level task runs at a time; starting another while one is open throws
 * `TaskAlreadyRunningError`. Worker progress attaches to the innermost running node.
 *
 * This is an external store (not jotai) because worker callbacks and hooks outside React write to
 * it. Read it in components with `useTasks()`. Dataset IDs in recorded text become dataset names
 * (`withDatasetNames`).
 */

import { withDatasetNames } from "../lib/dataset-names.ts";

export type TaskLevel = "info" | "warn" | "error";

export type TaskStatus = "running" | "cancelling" | "done" | "error" | "cancelled";

export interface TaskMessage {
  kind: "message";
  id: string;
  level: TaskLevel;
  message: string;
  /** Epoch milliseconds. */
  at: number;
}

export interface TaskError {
  message: string;
  stack?: string;
}

export interface TaskNode {
  kind: "task" | "step";
  id: string;
  title: string;
  status: TaskStatus;
  /** Epoch milliseconds. */
  startedAt: number;
  /** Epoch milliseconds; set once the node leaves `running`/`cancelling`. */
  endedAt?: number;
  /** Final one-line outcome, e.g. "monaco.pbf loaded". */
  summary?: string;
  /** The latest high-frequency progress line. Cleared when the node ends. */
  detail?: string;
  /** Reserved for determinate progress (0–1). Not displayed yet. */
  progress?: number;
  error?: TaskError;
  /** Only top-level tasks given an `AbortController` can be cancelled. */
  cancellable: boolean;
  children: ActivityEntry[];
}

export type ActivityEntry = TaskNode | TaskMessage;

export interface TasksSnapshot {
  /** Top-level entries, oldest first. */
  entries: ActivityEntry[];
  /** The open top-level task, if any. While set, no other task can start. */
  current: TaskNode | null;
  /** The most recently finished top-level task. */
  lastFinished: TaskNode | null;
}

export interface TaskStartOptions {
  /** Makes the task cancellable; `Tasks.cancel` aborts it. */
  controller?: AbortController;
}

/** A handle for writing to one Task or Step. */
export interface TaskHandle {
  readonly id: string;
  /** The top-level task's abort signal, when it was started with a controller. */
  readonly signal: AbortSignal | undefined;
  /** Open a child step. */
  step(title: string): TaskHandle;
  /** Run `fn` inside a child step, ending it on success and failing it on a throw. */
  runStep<T>(title: string, fn: (step: TaskHandle) => Promise<T>): Promise<T>;
  /** Record a permanent message under this node. */
  message(message: string, level?: TaskLevel): void;
  /** Replace this node's live progress line. */
  detail(text: string): void;
  /** Finish successfully. */
  end(summary?: string): void;
  /** Finish with an error. `summary` defaults to the error's message. */
  fail(error: unknown, summary?: string): void;
  /** Finish as cancelled, once the cancelled work has actually settled. */
  cancelled(summary?: string): void;
}

/** Thrown by `Tasks.start` when a top-level task is already open. */
export class TaskAlreadyRunningError extends Error {
  constructor(running: string, requested: string) {
    super(`Cannot start "${requested}" while "${running}" is still running.`);
    this.name = "TaskAlreadyRunningError";
  }
}

/** The number of top-level entries kept in the session history. */
export const TASK_HISTORY_LIMIT = 200;

const OPEN_STATUSES: ReadonlySet<TaskStatus> = new Set(["running", "cancelling"]);

export function isTaskOpen(node: TaskNode): boolean {
  return OPEN_STATUSES.has(node.status);
}

export function isTaskNode(entry: ActivityEntry): entry is TaskNode {
  return entry.kind !== "message";
}

/** Whether an error came from an aborted signal or a cancelled load. */
export function isCancellationError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "AbortError" || error.name === "LoadCancelledError")
  );
}

function toTaskError(error: unknown): TaskError {
  if (error instanceof Error) {
    return error.stack
      ? { message: error.message, stack: error.stack }
      : { message: error.message };
  }
  return { message: typeof error === "string" ? error : "Unknown error" };
}

/** The deepest open node under `node` (or `node` itself). */
export function innermostOpenNode(node: TaskNode): TaskNode {
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    if (child && isTaskNode(child) && isTaskOpen(child)) return innermostOpenNode(child);
  }
  return node;
}

/** The chain of open nodes from `node` down to the innermost one. */
export function openNodePath(node: TaskNode): TaskNode[] {
  const path = [node];
  let cursor = node;
  for (;;) {
    const next = cursor.children.findLast(
      (child): child is TaskNode => isTaskNode(child) && isTaskOpen(child),
    );
    if (!next) return path;
    path.push(next);
    cursor = next;
  }
}

export function createTaskStore({ now = () => Date.now() }: { now?: () => number } = {}) {
  const listeners = new Set<() => void>();
  const controllers = new Map<string, AbortController>();
  let entries: ActivityEntry[] = [];
  let snapshot: TasksSnapshot = { entries, current: null, lastFinished: null };
  let nextId = 0;
  const makeId = () => `t${++nextId}`;

  const emit = () => {
    const last = entries.at(-1);
    const current = last && isTaskNode(last) && isTaskOpen(last) ? last : null;
    const lastFinished =
      entries.findLast(
        (entry): entry is TaskNode =>
          isTaskNode(entry) && entry.kind === "task" && !isTaskOpen(entry),
      ) ?? null;
    snapshot = { entries, current, lastFinished };
    for (const listener of listeners) listener();
  };

  const appendRoot = (entry: ActivityEntry) => {
    entries = [...entries, entry];
    if (entries.length > TASK_HISTORY_LIMIT) entries = entries.slice(-TASK_HISTORY_LIMIT);
  };

  /** Rebuild the path to `id`, replacing its node with `update(node)`. */
  const updateNode = (id: string, update: (node: TaskNode) => TaskNode) => {
    const visit = (list: ActivityEntry[]): ActivityEntry[] | null => {
      for (let i = list.length - 1; i >= 0; i--) {
        const entry = list[i];
        if (!entry || !isTaskNode(entry)) continue;
        if (entry.id === id) {
          const next = list.slice();
          next[i] = update(entry);
          return next;
        }
        const children = visit(entry.children);
        if (children) {
          const next = list.slice();
          next[i] = { ...entry, children };
          return next;
        }
      }
      return null;
    };
    const next = visit(entries);
    if (!next) throw Error(`Task ${id} is not in the activity history.`);
    entries = next;
    emit();
  };

  const findNode = (id: string): TaskNode | null => {
    const visit = (list: ActivityEntry[]): TaskNode | null => {
      for (let i = list.length - 1; i >= 0; i--) {
        const entry = list[i];
        if (!entry || !isTaskNode(entry)) continue;
        if (entry.id === id) return entry;
        const found = visit(entry.children);
        if (found) return found;
      }
      return null;
    };
    return visit(entries);
  };

  const logToConsole = (message: string, level: TaskLevel) => {
    if (level === "error") console.error(message);
    else if (level === "warn") console.warn(message);
    else console.log(message);
  };

  /** Close `node` and every open descendant with `status`. */
  const close = (
    node: TaskNode,
    status: Exclude<TaskStatus, "running" | "cancelling">,
    at: number,
  ): TaskNode => {
    const children = node.children.map((child) =>
      isTaskNode(child) && isTaskOpen(child) ? close(child, status, at) : child,
    );
    const { detail: _detail, ...rest } = node;
    return { ...rest, status, endedAt: at, children };
  };

  const finish = (
    id: string,
    status: Exclude<TaskStatus, "running" | "cancelling">,
    extra: Pick<TaskNode, "summary" | "error">,
  ) => {
    const node = findNode(id);
    if (!node) throw Error(`Task ${id} is not in the activity history.`);
    if (!isTaskOpen(node)) throw Error(`"${node.title}" has already finished (${node.status}).`);
    const at = now();
    updateNode(id, (current) => ({ ...close(current, status, at), ...extra }));
    if (node.kind === "task") controllers.delete(id);
    const line = extra.summary ?? node.title;
    logToConsole(`${line} (${at - node.startedAt}ms)`, status === "error" ? "error" : "info");
  };

  const handle = (id: string, signal: AbortSignal | undefined): TaskHandle => {
    const self: TaskHandle = {
      id,
      signal,
      step(title) {
        const stepId = makeId();
        const step: TaskNode = {
          kind: "step",
          id: stepId,
          title,
          status: "running",
          startedAt: now(),
          cancellable: false,
          children: [],
        };
        updateNode(id, (node) => {
          if (!isTaskOpen(node)) throw Error(`Cannot add "${title}" to finished "${node.title}".`);
          const { detail: _detail, ...rest } = node;
          return { ...rest, children: [...node.children, step] };
        });
        logToConsole(title, "info");
        return handle(stepId, signal);
      },
      async runStep(title, fn) {
        const step = self.step(title);
        try {
          const result = await fn(step);
          if (findNode(step.id)?.status === "running") step.end();
          return result;
        } catch (error) {
          const node = findNode(step.id);
          if (node && isTaskOpen(node)) {
            if (signal?.aborted || isCancellationError(error)) step.cancelled();
            else step.fail(error);
          }
          throw error;
        }
      },
      message(text, level = "info") {
        const message = withDatasetNames(text);
        const entry: TaskMessage = { kind: "message", id: makeId(), level, message, at: now() };
        updateNode(id, (node) => ({ ...node, children: [...node.children, entry] }));
        logToConsole(message, level);
      },
      detail(text) {
        updateNode(id, (node) => ({ ...node, detail: withDatasetNames(text) }));
      },
      end(summary) {
        finish(id, "done", summary === undefined ? {} : { summary });
      },
      fail(error, summary) {
        const taskError = toTaskError(error);
        finish(id, "error", {
          summary: withDatasetNames(summary ?? taskError.message),
          error: taskError,
        });
      },
      cancelled(summary) {
        finish(id, "cancelled", { summary: summary ?? "Cancelled" });
      },
    };
    return self;
  };

  const start = (title: string, options: TaskStartOptions = {}): TaskHandle => {
    if (snapshot.current) throw new TaskAlreadyRunningError(snapshot.current.title, title);
    const id = makeId();
    const task: TaskNode = {
      kind: "task",
      id,
      title,
      status: options.controller?.signal.aborted ? "cancelling" : "running",
      startedAt: now(),
      cancellable: options.controller !== undefined,
      children: [],
    };
    if (options.controller) {
      controllers.set(id, options.controller);
      // Any abort (the nav's Cancel or a caller's own button) moves the task to `cancelling`.
      options.controller.signal.addEventListener("abort", () => markCancelling(id), {
        once: true,
      });
    }
    appendRoot(task);
    emit();
    logToConsole(title, "info");
    return handle(id, options.controller?.signal);
  };

  const run = async <T>(
    title: string,
    fn: (task: TaskHandle) => Promise<T>,
    options: TaskStartOptions & {
      /** Summary for a successful run, derived from the result. */
      summary?: (result: T) => string | undefined;
    } = {},
  ): Promise<T> => {
    const task = start(title, options);
    try {
      const result = await fn(task);
      if (findNode(task.id)?.status === "running" || findNode(task.id)?.status === "cancelling") {
        task.end(options.summary?.(result));
      }
      return result;
    } catch (error) {
      const node = findNode(task.id);
      if (node && isTaskOpen(node)) {
        if (task.signal?.aborted || isCancellationError(error)) task.cancelled();
        else task.fail(error);
      }
      throw error;
    }
  };

  const markCancelling = (id: string) => {
    if (findNode(id)?.status !== "running") return;
    updateNode(id, (current) => ({ ...current, status: "cancelling" }));
  };

  /** Abort the open task. It stays `cancelling`, and holds the lock, until its work settles. */
  const cancel = (id: string) => {
    const controller = controllers.get(id);
    if (!controller) throw Error(`Task ${id} cannot be cancelled.`);
    controller.abort();
  };

  /** Where a loose message or progress line lands: the innermost open node, if any. */
  const openTarget = () => (snapshot.current ? innermostOpenNode(snapshot.current) : null);

  /** Record a message on the innermost running node, or as a top-level entry when idle. */
  const message = (text: string, level: TaskLevel = "info") => {
    const target = openTarget();
    if (target) {
      handle(target.id, undefined).message(text, level);
      return;
    }
    appendRoot({ kind: "message", id: makeId(), level, message: text, at: now() });
    emit();
    logToConsole(text, level);
  };

  /** Update the innermost running node's live progress line. Ignored when idle. */
  const detail = (text: string) => {
    const target = openTarget();
    if (target) handle(target.id, undefined).detail(text);
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    start,
    run,
    cancel,
    message,
    detail,
    /** Clear the history. Tests only: fails if a task is open. */
    reset: () => {
      if (snapshot.current) throw Error("Cannot reset while a task is running.");
      entries = [];
      controllers.clear();
      emit();
    },
  };
}

export type TaskStore = ReturnType<typeof createTaskStore>;

export const Tasks: TaskStore = createTaskStore();
