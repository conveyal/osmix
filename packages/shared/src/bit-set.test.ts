import { describe, expect, it } from "vitest";

import { BitSet } from "./bit-set.ts";

describe("BitSet", () => {
  it("adds, checks, and deletes bits across byte boundaries", () => {
    const set = new BitSet(17);
    for (const index of [0, 7, 8, 16]) {
      expect(set.has(index)).toBe(false);
      set.add(index);
      expect(set.has(index)).toBe(true);
    }
    expect(set.has(1)).toBe(false);
    expect(set.has(9)).toBe(false);
    set.delete(8);
    expect(set.has(8)).toBe(false);
    expect(set.has(7)).toBe(true);
  });

  it("counts set bits and iterates them in ascending order", () => {
    const set = new BitSet(40);
    for (const index of [39, 3, 8, 3, 17]) set.add(index);
    expect(set.count).toBe(4);
    set.delete(8);
    set.delete(8);
    expect(set.count).toBe(3);
    const seen: number[] = [];
    set.forEach((index) => seen.push(index));
    expect(seen).toEqual([3, 17, 39]);
  });

  it("clones independently", () => {
    const set = new BitSet(10);
    set.add(3);
    const copy = set.clone();
    copy.add(4);
    expect(copy.has(3)).toBe(true);
    expect(copy.count).toBe(2);
    expect(set.has(4)).toBe(false);
    expect(set.count).toBe(1);
  });

  it("throws on out-of-range indexes and invalid sizes", () => {
    const set = new BitSet(8);
    expect(() => set.has(8)).toThrow(/out of range/);
    expect(() => set.add(-1)).toThrow(/out of range/);
    expect(() => set.delete(1.5)).toThrow(/out of range/);
    expect(() => new BitSet(-1)).toThrow(/Invalid BitSet size/);
  });

  it("supports an empty set", () => {
    const set = new BitSet(0);
    expect(set.size).toBe(0);
    expect(() => set.has(0)).toThrow(/out of range/);
  });
});
