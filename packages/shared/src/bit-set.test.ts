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

  it("wraps a caller's buffer without copying and counts its bits lazily", () => {
    const buffer = new SharedArrayBuffer(BitSet.byteLength(20));
    new Uint8Array(buffer).set([0b0000_0101, 0b1000_0000]);
    const set = new BitSet(20, buffer);
    expect(set.buffer).toBe(buffer);
    expect(set.has(0)).toBe(true);
    expect(set.has(2)).toBe(true);
    expect(set.has(15)).toBe(true);
    expect(set.count).toBe(3);
    set.add(19);
    expect(set.count).toBe(4);
    expect(new Uint8Array(buffer)[2]).toBe(0b0000_1000);
    // Another view of the same buffer sees the bit.
    expect(new BitSet(20, buffer).has(19)).toBe(true);
  });

  it("rejects a buffer that is too small", () => {
    expect(() => new BitSet(17, new ArrayBuffer(2))).toThrow(/17 slots need 3/);
  });

  it("clones a wrapped set into its own buffer", () => {
    const buffer = new ArrayBuffer(1);
    const set = new BitSet(8, buffer);
    set.add(1);
    const copy = set.clone();
    copy.add(2);
    expect(copy.buffer).not.toBe(buffer);
    expect(set.has(2)).toBe(false);
    expect(copy.count).toBe(2);
  });

  it("has unchecked paths that match the checked ones", () => {
    const set = new BitSet(12);
    set.addUnchecked(11);
    set.addUnchecked(11);
    set.addUnchecked(3);
    expect(set.count).toBe(2);
    expect(set.hasUnchecked(11)).toBe(true);
    expect(set.hasUnchecked(4)).toBe(false);
    // Past the last byte there are no bits.
    expect(set.hasUnchecked(64)).toBe(false);
  });
});
