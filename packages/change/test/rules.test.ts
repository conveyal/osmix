import { describe, expect, it } from "vitest";

import { accessSignature, barrierSignature } from "../src/rules/access.ts";
import { isAreaWay, isPolygonish } from "../src/rules/area.ts";
import {
  hasAdjacentDuplicateRefs,
  hasTooFewDistinctRefs,
  refsWouldCollapse,
} from "../src/rules/collapse.ts";
import { hasConflictingGradeOrAccessTags, routingGradeSignature } from "../src/rules/grade.ts";
import { familyCompatible, isRoutingProperty, wayRoutingFamily } from "../src/rules/routing.ts";
import { isDescriptiveWayTag, routingSemanticTagsEqual } from "../src/rules/tags.ts";

describe("merge rule primitives", () => {
  it("normalizes grade for matching but compares it raw for exact reconciliation", () => {
    expect(routingGradeSignature({ bridge: "no", layer: "0" })).toBe(routingGradeSignature({}));
    expect(routingGradeSignature({ bridge: "false" })).toBe(routingGradeSignature({}));
    expect(routingGradeSignature({ layer: "1" })).not.toBe(routingGradeSignature({}));
    expect(hasConflictingGradeOrAccessTags({ bridge: "no" }, {})).toBe(false);
    expect(hasConflictingGradeOrAccessTags({ bridge: "false" }, {})).toBe(true);
    expect(hasConflictingGradeOrAccessTags({ barrier: "gate" }, {})).toBe(true);
  });

  it("includes namespaced access keys in the routing access signature", () => {
    expect(accessSignature({ "access:conditional": "no @ (22:00-06:00)", name: "x" })).toBe(
      "access:conditional=no @ (22:00-06:00)",
    );
    expect(barrierSignature({ barrier: "gate", "barrier:height": "1" })).toBe(
      "barrier=gate|barrier:height=1",
    );
    expect(isRoutingProperty("maxspeed:forward")).toBe(true);
    expect(isRoutingProperty("surface")).toBe(false);
  });

  it("keeps descriptive tags out of routing comparisons", () => {
    expect(isDescriptiveWayTag("name:fr")).toBe(true);
    expect(isDescriptiveWayTag("surface")).toBe(false);
    expect(
      routingSemanticTagsEqual({ highway: "footway", name: "A" }, { highway: "footway" }),
    ).toBe(true);
    expect(
      routingSemanticTagsEqual({ highway: "footway", surface: "x" }, { highway: "footway" }),
    ).toBe(false);
  });

  it("names both area predicates (gap G2)", () => {
    const ring = { id: 1, refs: [1, 2, 3, 1], tags: { boundary: "administrative" } };
    expect(isAreaWay(ring)).toBe(true);
    expect(isPolygonish(ring.tags)).toBe(false);
    expect(isAreaWay({ id: 2, refs: [1, 2], tags: { highway: "pedestrian", area: "yes" } })).toBe(
      true,
    );
  });

  it("classifies routing families", () => {
    expect(wayRoutingFamily({ id: 1, refs: [1, 2], tags: { highway: "footway" } })).toBe(
      "pedestrian",
    );
    expect(wayRoutingFamily({ id: 1, refs: [1, 2], tags: { highway: "residential" } })).toBe(
      "motor-road",
    );
    expect(familyCompatible("pedestrian", "bicycle-shared")).toBe(true);
    expect(familyCompatible("pedestrian", "motor-road")).toBe(false);
  });

  it("detects collapsed and zero-length ways", () => {
    expect(hasAdjacentDuplicateRefs([1, 1, 2])).toBe(true);
    expect(hasTooFewDistinctRefs([1, 2, 1])).toBe(false);
    expect(hasTooFewDistinctRefs([1, 1])).toBe(true);
    expect(refsWouldCollapse([1, 2, 3])).toBe(false);
  });
});
