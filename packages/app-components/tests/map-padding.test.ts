import { describe, expect, it } from "vitest";

import { paddingOffset, withMapInset } from "../src/hooks/map.ts";

describe("withMapInset", () => {
  it("pads every edge by the base and adds the inset on the right", () => {
    expect(withMapInset(100, { right: 400 }, 1440)).toEqual({
      top: 100,
      right: 500,
      bottom: 100,
      left: 100,
    });
  });

  it("is the base padding alone without an inset", () => {
    expect(withMapInset(50, { right: 0 }, 1440)).toEqual({
      top: 50,
      right: 50,
      bottom: 50,
      left: 50,
    });
  });

  it("clamps the right padding so left + right stays under the map width", () => {
    const padding = withMapInset(100, { right: 400 }, 500);
    expect(padding.left + padding.right).toBeLessThan(500);
    expect(padding).toEqual({ top: 100, right: 399, bottom: 100, left: 100 });
  });

  it("never clamps below zero", () => {
    expect(withMapInset(100, { right: 400 }, 50).right).toBe(0);
  });

  it("leaves the inset alone without a map width", () => {
    expect(withMapInset(100, { right: 400 }, null).right).toBe(500);
  });
});

describe("paddingOffset", () => {
  it("shifts the centre into the padded area", () => {
    expect(paddingOffset({ top: 0, right: 400, bottom: 0, left: 0 })).toEqual([-200, 0]);
    expect(paddingOffset({ top: 100, right: 100, bottom: 100, left: 100 })).toEqual([0, 0]);
    expect(paddingOffset({ top: 0, right: 0, bottom: 300, left: 40 })).toEqual([20, -150]);
  });
});
