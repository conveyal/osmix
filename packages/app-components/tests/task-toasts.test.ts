import { createTaskStore } from "@osmix/app-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUIET_TASK_MS, taskToasts } from "../src/components/task-toasts.tsx";

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

describe("taskToasts", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("skips quick successes and toasts slow ones with their duration", () => {
    const { store, advance } = makeStore();
    let prev = store.getSnapshot();
    const quick = store.start("Save to browser storage");
    advance(QUIET_TASK_MS - 1);
    quick.end("monaco.pbf saved to storage");
    expect(taskToasts(prev, store.getSnapshot())).toEqual([]);

    prev = store.getSnapshot();
    const slow = store.start("Open monaco.pbf");
    const running = store.getSnapshot();
    expect(taskToasts(prev, running)).toEqual([]);
    advance(2_310);
    slow.end("monaco.pbf loaded");
    expect(taskToasts(running, store.getSnapshot())).toEqual([
      {
        variant: "success",
        title: "monaco.pbf loaded",
        description: "Open monaco.pbf took 2.31s",
      },
    ]);
  });

  it("keeps errors with a link to details, and cancels quietly", () => {
    const { store } = makeStore();
    const failing = store.start("Open monaco.pbf");
    let prev = store.getSnapshot();
    failing.fail(new Error("Out of memory"), "Could not load monaco.pbf");
    expect(taskToasts(prev, store.getSnapshot())).toEqual([
      {
        variant: "error",
        title: "Open monaco.pbf failed",
        description: "Could not load monaco.pbf",
        viewDetails: true,
      },
    ]);

    const cancelled = store.start("Open monaco.pbf");
    prev = store.getSnapshot();
    cancelled.cancelled("monaco.pbf loading cancelled");
    expect(taskToasts(prev, store.getSnapshot())).toEqual([
      { variant: "info", title: "monaco.pbf loading cancelled" },
    ]);
  });

  it("toasts new top-level error messages but not steps or older entries", () => {
    const { store } = makeStore();
    const task = store.start("Run automatic merge");
    let prev = store.getSnapshot();
    task.step("Discover imported-data matches").end();
    expect(taskToasts(prev, store.getSnapshot())).toEqual([]);
    task.end();

    prev = store.getSnapshot();
    store.message("Insufficient storage", "error");
    const afterMessage = store.getSnapshot();
    expect(taskToasts(prev, afterMessage)).toEqual([
      { variant: "error", title: "Insufficient storage", viewDetails: true },
    ]);
    store.message("Unrelated info");
    expect(taskToasts(afterMessage, store.getSnapshot())).toEqual([]);
  });
});
