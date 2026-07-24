import { describe, expect, it } from "vitest";

import { BinaryHeap } from "../src/binary-heap.ts";

describe("BinaryHeap", () => {
  it("preserves priority order when a replacement must move down multiple levels", () => {
    const heap = new BinaryHeap();
    for (let priority = 1; priority <= 7; priority++) {
      heap.push(priority, priority);
    }

    const popped: number[] = [];
    while (heap.size > 0) popped.push(heap.pop()!);

    expect(popped).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("preserves ordering after decreasing an existing item's priority", () => {
    const heap = new BinaryHeap();
    heap.push(1, 10);
    heap.push(2, 20);
    heap.push(3, 30);
    heap.push(3, 5);

    expect([heap.pop(), heap.pop(), heap.pop()]).toEqual([3, 1, 2]);
  });
});
