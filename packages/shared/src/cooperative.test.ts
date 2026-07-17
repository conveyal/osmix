import { describe, expect, it, vi } from "vitest";

import { runCooperatively } from "./cooperative.ts";

describe("runCooperatively", () => {
  it("yields between bounded work slices and returns the iterator value", async () => {
    let clock = 0;
    const yielded = vi.fn(async () => undefined);
    function* work(): Generator<void, string> {
      for (let index = 0; index < 5; index++) {
        clock += 3;
        yield;
      }
      return "done";
    }

    await expect(
      runCooperatively(work(), {
        now: () => clock,
        timeSliceMs: 5,
        yieldToEventLoop: yielded,
      }),
    ).resolves.toEqual({ status: "completed", value: "done" });
    expect(yielded).toHaveBeenCalledTimes(2);
  });

  it("closes the iterator when cancellation is observed", async () => {
    let steps = 0;
    let closed = false;
    function* work(): Generator<void, void> {
      try {
        while (true) {
          steps++;
          yield;
        }
      } finally {
        closed = true;
      }
    }

    await expect(
      runCooperatively(work(), {
        isCancelled: () => steps >= 3,
        now: () => steps,
        timeSliceMs: 100,
      }),
    ).resolves.toEqual({ status: "cancelled" });
    expect(closed).toBe(true);
  });
});
