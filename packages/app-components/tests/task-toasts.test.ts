import { createTaskStore } from "@osmix/app-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUIET_TASK_MS, taskToastEvents } from "../src/components/task-toasts.tsx";
import { latestErrorId } from "../src/state/activity.ts";

function makeStore() {
  let now = 0;
  const store = createTaskStore({ now: () => now });
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("taskToastEvents", () => {
  it("starts a task's toast, closes quick successes and replaces slow ones", () => {
    const { store, advance } = makeStore();
    let prev = store.getSnapshot();
    const quick = store.start("Save to browser storage");
    const quickId = store.getSnapshot().current?.id;
    expect(taskToastEvents(prev, store.getSnapshot())).toEqual([
      { kind: "started", taskId: quickId },
    ]);
    prev = store.getSnapshot();
    advance(QUIET_TASK_MS - 1);
    quick.end("monaco.pbf saved to storage");
    expect(taskToastEvents(prev, store.getSnapshot())).toEqual([
      { kind: "finished", taskId: quickId, toast: null },
    ]);

    const slow = store.start("Open monaco.pbf");
    const running = store.getSnapshot();
    const slowId = running.current?.id;
    advance(2_310);
    slow.end("monaco.pbf loaded");
    expect(taskToastEvents(running, store.getSnapshot())).toEqual([
      {
        kind: "finished",
        taskId: slowId,
        toast: {
          variant: "success",
          title: "monaco.pbf loaded",
          description: "Open monaco.pbf took 2.31s",
        },
      },
    ]);
  });

  it("keeps errors with a link to details, and cancels neutrally", () => {
    const { store } = makeStore();
    const failing = store.start("Open monaco.pbf");
    let prev = store.getSnapshot();
    failing.fail(new Error("Out of memory"), "Could not load monaco.pbf");
    expect(taskToastEvents(prev, store.getSnapshot())).toEqual([
      {
        kind: "finished",
        taskId: prev.current?.id,
        toast: {
          variant: "error",
          title: "Open monaco.pbf failed",
          description: "Could not load monaco.pbf",
          viewDetails: true,
        },
      },
    ]);

    const cancelled = store.start("Open monaco.pbf");
    prev = store.getSnapshot();
    cancelled.cancelled("monaco.pbf loading cancelled");
    expect(taskToastEvents(prev, store.getSnapshot())).toEqual([
      {
        kind: "finished",
        taskId: prev.current?.id,
        toast: { variant: "info", title: "monaco.pbf loading cancelled" },
      },
    ]);
  });

  it("gives a task that failed before any snapshot saw it running its outcome", () => {
    const { store } = makeStore();
    const prev = store.getSnapshot();
    store.start("Open monaco.pbf").fail(new Error("Bad header"));
    const events = taskToastEvents(prev, store.getSnapshot());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "finished",
      toast: { variant: "error", title: "Open monaco.pbf failed", viewDetails: true },
    });
  });

  it("toasts new top-level error messages but not steps or older entries", () => {
    const { store } = makeStore();
    const task = store.start("Run automatic merge");
    let prev = store.getSnapshot();
    task.step("Discover imported-data matches").end();
    expect(taskToastEvents(prev, store.getSnapshot())).toEqual([]);
    task.end();

    prev = store.getSnapshot();
    store.message("Insufficient storage", "error");
    const afterMessage = store.getSnapshot();
    expect(taskToastEvents(prev, afterMessage)).toEqual([
      {
        kind: "message",
        id: afterMessage.entries.at(-1)?.id,
        toast: { variant: "error", title: "Insufficient storage", viewDetails: true },
      },
    ]);
    store.message("Unrelated info");
    expect(taskToastEvents(afterMessage, store.getSnapshot())).toEqual([]);
  });
});

describe("latestErrorId", () => {
  it("finds the newest failed task or error message, ignoring successes and info", () => {
    const { store } = makeStore();
    expect(latestErrorId(store.getSnapshot().entries)).toBeNull();

    store.start("Open monaco.pbf").fail(new Error("Bad header"));
    const failedId = store.getSnapshot().entries.at(-1)?.id;
    store.start("Open monaco.pbf").end();
    store.message("Loaded from cache");
    expect(latestErrorId(store.getSnapshot().entries)).toBe(failedId);

    store.message("Insufficient storage", "error");
    expect(latestErrorId(store.getSnapshot().entries)).toBe(store.getSnapshot().entries.at(-1)?.id);
  });
});
