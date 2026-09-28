import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createThrottledProgressLogger } from "../src/lib/progress-log.ts";
import {
  createTaskStore,
  isTaskNode,
  openNodePath,
  TASK_HISTORY_LIMIT,
  TaskAlreadyRunningError,
  type TaskNode,
} from "../src/state/tasks.ts";

function makeStore() {
  let now = 1_000;
  const store = createTaskStore({ now: () => now });
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function rootTask(store: ReturnType<typeof createTaskStore>, index = -1): TaskNode {
  const entry = store.getSnapshot().entries.at(index);
  if (!entry || !isTaskNode(entry)) throw Error("Expected a task");
  return entry;
}

describe("task store", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("allows one top-level task at a time", () => {
    const { store } = makeStore();
    const task = store.start("Open monaco.pbf");
    expect(() => store.start("Open other.pbf")).toThrow(TaskAlreadyRunningError);
    task.end();
    expect(() => store.start("Open other.pbf").end()).not.toThrow();
  });

  it("nests steps and times every node from its own start and end", () => {
    const { store, advance } = makeStore();
    const task = store.start("Open monaco.pbf");
    advance(100);
    const hash = task.step("Hash file");
    advance(250);
    hash.end();
    const parse = task.step("Parse and index file");
    advance(2_000);
    parse.end();
    task.end("monaco.pbf loaded");

    const node = rootTask(store);
    expect(node).toMatchObject({ status: "done", summary: "monaco.pbf loaded" });
    expect(node.endedAt! - node.startedAt).toBe(2_350);
    const [hashNode, parseNode] = node.children as TaskNode[];
    expect(hashNode).toMatchObject({ kind: "step", title: "Hash file", status: "done" });
    expect(hashNode!.endedAt! - hashNode!.startedAt).toBe(250);
    expect(parseNode!.endedAt! - parseNode!.startedAt).toBe(2_000);
  });

  it("closes open steps with the task's final status", () => {
    const { store } = makeStore();
    const task = store.start("Open monaco.pbf");
    task.step("Parse and index file");
    task.fail(new Error("Out of memory"), "Could not load monaco.pbf");

    const node = rootTask(store);
    expect(node.status).toBe("error");
    expect(node.summary).toBe("Could not load monaco.pbf");
    expect(node.error?.message).toBe("Out of memory");
    expect((node.children[0] as TaskNode).status).toBe("error");
    expect(store.getSnapshot().current).toBeNull();
  });

  it("refuses to finish a node twice", () => {
    const { store } = makeStore();
    const task = store.start("Save to browser storage");
    task.end();
    expect(() => task.end()).toThrow(/already finished/);
  });

  it("run ends the task on success and fails it on a throw, releasing the lock", async () => {
    const { store } = makeStore();
    await expect(
      store.run("Scan base", async () => "3 changes", { summary: (s) => s }),
    ).resolves.toBe("3 changes");
    expect(rootTask(store)).toMatchObject({ status: "done", summary: "3 changes" });

    await expect(
      store.run("Scan patch", async () => {
        throw new Error("Worker crashed");
      }),
    ).rejects.toThrow("Worker crashed");
    expect(rootTask(store)).toMatchObject({ status: "error", summary: "Worker crashed" });
    expect(store.getSnapshot().current).toBeNull();
  });

  it("runStep fails the step and the task when the step throws", async () => {
    const { store } = makeStore();
    await expect(
      store.run("Open monaco.pbf", (task) =>
        task.runStep("Hash file", async () => {
          throw new Error("Hash failed");
        }),
      ),
    ).rejects.toThrow("Hash failed");
    const node = rootTask(store);
    expect(node.status).toBe("error");
    expect((node.children[0] as TaskNode).status).toBe("error");
  });

  it("holds the lock while cancelling until the work settles", async () => {
    const { store } = makeStore();
    const controller = new AbortController();
    let settle!: () => void;
    const work = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const running = store.run(
      "Open monaco.pbf",
      async (task) => {
        await work;
        if (task.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      },
      { controller },
    );
    const id = store.getSnapshot().current!.id;
    expect(store.getSnapshot().current?.cancellable).toBe(true);

    store.cancel(id);
    expect(store.getSnapshot().current?.status).toBe("cancelling");
    expect(() => store.start("Something else")).toThrow(TaskAlreadyRunningError);

    settle();
    await expect(running).rejects.toThrow("Aborted");
    expect(rootTask(store).status).toBe("cancelled");
    expect(store.getSnapshot().current).toBeNull();
  });

  it("marks a task cancelling when its controller is aborted elsewhere", () => {
    const { store } = makeStore();
    const controller = new AbortController();
    const task = store.start("Open monaco.pbf", { controller });
    controller.abort();
    expect(store.getSnapshot().current?.status).toBe("cancelling");
    task.cancelled();
    expect(rootTask(store).status).toBe("cancelled");
  });

  it("only cancels tasks that were given a controller", () => {
    const { store } = makeStore();
    const task = store.start("Export monaco.pbf");
    expect(store.getSnapshot().current?.cancellable).toBe(false);
    expect(() => store.cancel(task.id)).toThrow(/cannot be cancelled/);
    task.end();
  });

  it("puts loose messages on the innermost open node, or the top level when idle", () => {
    const { store } = makeStore();
    store.message("Insufficient storage", "error");
    expect(store.getSnapshot().entries[0]).toMatchObject({ kind: "message", level: "error" });

    const task = store.start("Run automatic merge");
    const stage = task.step("Discover imported-data matches");
    store.message("Found 12 candidates");
    store.detail("Block 3 of 40");

    const current = store.getSnapshot().current!;
    const path = openNodePath(current);
    expect(path.map((node) => node.title)).toEqual([
      "Run automatic merge",
      "Discover imported-data matches",
    ]);
    expect(path[1]!.children[0]).toMatchObject({ kind: "message", message: "Found 12 candidates" });
    expect(path[1]!.detail).toBe("Block 3 of 40");

    stage.end();
    expect((rootTask(store).children[0] as TaskNode).detail).toBeUndefined();
    task.end();
  });

  it("keeps only the most recent top-level entries", () => {
    const { store } = makeStore();
    for (let i = 0; i < TASK_HISTORY_LIMIT + 5; i++) store.start(`Task ${i}`).end();
    const { entries, lastFinished } = store.getSnapshot();
    expect(entries).toHaveLength(TASK_HISTORY_LIMIT);
    expect((entries[0] as TaskNode).title).toBe("Task 5");
    expect(lastFinished?.title).toBe(`Task ${TASK_HISTORY_LIMIT + 4}`);
  });
});

describe("createThrottledProgressLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const progress = (msg: string, level: "info" | "warn" | "error" = "info", throttle = false) => ({
    msg,
    level,
    throttle,
    timestamp: 0,
  });

  it("sends throttled progress to the running step's detail, not the history", () => {
    const { store } = makeStore();
    const onProgress = createThrottledProgressLogger(store, 0);
    const task = store.start("Open monaco.pbf");
    task.step("Parse and index file");
    onProgress(progress("Block 1", "info", true));
    onProgress(progress("Block 2", "info", true));
    const step = openNodePath(store.getSnapshot().current!).at(-1)!;
    expect(step.detail).toBe("Block 2");
    expect(step.children).toHaveLength(0);
    task.end();
  });

  it("keeps the level of other progress messages", () => {
    const { store } = makeStore();
    const onProgress = createThrottledProgressLogger(store);
    const task = store.start("Open monaco.pbf");
    onProgress(progress("Missing node refs", "warn"));
    expect(store.getSnapshot().current!.children[0]).toMatchObject({
      kind: "message",
      level: "warn",
      message: "Missing node refs",
    });
    task.end();
  });

  it("records progress as a top-level message when no task is open", () => {
    const { store } = makeStore();
    createThrottledProgressLogger(store)(progress("Worker ready"));
    expect(store.getSnapshot().entries).toEqual([
      expect.objectContaining({ kind: "message", message: "Worker ready" }),
    ]);
  });

  it("drops throttled progress when idle", () => {
    const { store } = makeStore();
    createThrottledProgressLogger(store)(progress("Block 1", "info", true));
    expect(store.getSnapshot().entries).toHaveLength(0);
  });
});
