import { describe, expect, it } from "vitest";

import { slotOsmId, slotOsmIdPrefix } from "../src/lib/slot-osm-id.ts";

describe("slot dataset IDs", () => {
  it("gives each slot its own ID for the same file", () => {
    expect(slotOsmId("base", "abc")).toBe("base-abc");
    expect(slotOsmId("inspect", "abc")).toBe("inspect-abc");
    expect(slotOsmId("base", "abc").startsWith(slotOsmIdPrefix("base"))).toBe(true);
  });

  it("refuses empty keys", () => {
    expect(() => slotOsmId("base", "")).toThrow("A slot dataset needs a file key.");
    expect(() => slotOsmIdPrefix("")).toThrow("A slot dataset needs a slot key.");
  });
});
