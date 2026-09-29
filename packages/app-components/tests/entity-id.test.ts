import { describe, expect, it } from "vitest";

import { parseEntityQuery } from "../src/lib/entity-id.ts";

describe("parseEntityQuery", () => {
  it("reads the full type with a slash", () => {
    expect(parseEntityQuery("node/123")).toEqual({ type: "node", id: 123 });
    expect(parseEntityQuery("way/42")).toEqual({ type: "way", id: 42 });
    expect(parseEntityQuery("relation/-5")).toEqual({ type: "relation", id: -5 });
  });

  it("reads the full type with whitespace", () => {
    expect(parseEntityQuery("way 123")).toEqual({ type: "way", id: 123 });
    expect(parseEntityQuery("node\t7")).toEqual({ type: "node", id: 7 });
    expect(parseEntityQuery("relation / 9")).toEqual({ type: "relation", id: 9 });
  });

  it("reads the single-letter prefixes", () => {
    expect(parseEntityQuery("n123")).toEqual({ type: "node", id: 123 });
    expect(parseEntityQuery("w123")).toEqual({ type: "way", id: 123 });
    expect(parseEntityQuery("r123")).toEqual({ type: "relation", id: 123 });
    expect(parseEntityQuery("n/123")).toEqual({ type: "node", id: 123 });
    expect(parseEntityQuery("w 123")).toEqual({ type: "way", id: 123 });
  });

  it("ignores case and surrounding whitespace", () => {
    expect(parseEntityQuery("  Node/123  ")).toEqual({ type: "node", id: 123 });
    expect(parseEntityQuery("WAY 5")).toEqual({ type: "way", id: 5 });
    expect(parseEntityQuery("R-2")).toEqual({ type: "relation", id: -2 });
  });

  it("treats everything else as a place query", () => {
    expect(parseEntityQuery("")).toBeNull();
    expect(parseEntityQuery("Monaco")).toBeNull();
    expect(parseEntityQuery("node")).toBeNull();
    expect(parseEntityQuery("node/")).toBeNull();
    expect(parseEntityQuery("nodes/1")).toBeNull();
    expect(parseEntityQuery("node/1a")).toBeNull();
    expect(parseEntityQuery("node/1/2")).toBeNull();
    expect(parseEntityQuery("Rue Grimaldi 12")).toBeNull();
    expect(parseEntityQuery("area/1")).toBeNull();
  });
});
