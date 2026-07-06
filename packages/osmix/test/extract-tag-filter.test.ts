import { describe, expect, test } from "vitest";

import {
  CONVEYAL_EXTRACT_TAG_FILTERS,
  entityMatchesTagRules,
  normalizeTagFilterRules,
  relationMatchesExtractTagRules,
  tagRuleMatches,
  wayMatchesExtractTagRules,
} from "../src/extract-tag-filter";

describe("extract-tag-filter", () => {
  test("normalizeTagFilterRules trims and drops blank keys", () => {
    const normalized = normalizeTagFilterRules({
      nodes: [{ key: "  amenity ", value: "  bench  " }, { key: "  " }],
      ways: [{ key: "highway", value: "" }],
      relations: [],
    });
    expect(normalized.nodes).toEqual([{ key: "amenity", value: "bench" }]);
    expect(normalized.ways).toEqual([{ key: "highway" }]);
  });

  test("tagRuleMatches any value when value omitted", () => {
    expect(tagRuleMatches({ highway: "primary" }, { key: "highway" })).toBe(true);
    expect(tagRuleMatches({ highway: "primary" }, { key: "railway" })).toBe(false);
  });

  test("tagRuleMatches exact value", () => {
    expect(
      tagRuleMatches(
        { public_transport: "platform" },
        { key: "public_transport", value: "platform" },
      ),
    ).toBe(true);
    expect(
      tagRuleMatches(
        { public_transport: "stop_position" },
        { key: "public_transport", value: "platform" },
      ),
    ).toBe(false);
  });

  test("entityMatchesTagRules with zero rules passes", () => {
    expect(entityMatchesTagRules({ building: "yes" }, [])).toBe(true);
  });

  test("entityMatchesTagRules single rule is required", () => {
    const rules = [{ key: "highway" }];
    expect(entityMatchesTagRules({ highway: "road" }, rules)).toBe(true);
    expect(entityMatchesTagRules({ building: "yes" }, rules)).toBe(false);
  });

  test("entityMatchesTagRules multiple rules use OR", () => {
    const rules = [{ key: "highway" }, { key: "public_transport", value: "platform" }];
    expect(entityMatchesTagRules({ highway: "road" }, rules)).toBe(true);
    expect(entityMatchesTagRules({ public_transport: "platform" }, rules)).toBe(true);
    expect(entityMatchesTagRules({ building: "yes" }, rules)).toBe(false);
  });

  test("CONVEYAL_EXTRACT_TAG_FILTERS way regression", () => {
    const rules = CONVEYAL_EXTRACT_TAG_FILTERS;
    expect(
      wayMatchesExtractTagRules({ id: 1, refs: [], tags: { highway: "primary" } }, rules),
    ).toBe(true);
    expect(
      wayMatchesExtractTagRules({ id: 2, refs: [], tags: { public_transport: "platform" } }, rules),
    ).toBe(true);
    expect(
      wayMatchesExtractTagRules({ id: 3, refs: [], tags: { railway: "platform" } }, rules),
    ).toBe(true);
    expect(wayMatchesExtractTagRules({ id: 4, refs: [], tags: { park_ride: "yes" } }, rules)).toBe(
      true,
    );
    expect(wayMatchesExtractTagRules({ id: 5, refs: [], tags: { building: "yes" } }, rules)).toBe(
      false,
    );
  });

  test("CONVEYAL_EXTRACT_TAG_FILTERS relation regression", () => {
    const rules = CONVEYAL_EXTRACT_TAG_FILTERS;
    expect(
      relationMatchesExtractTagRules({ id: 1, members: [], tags: { type: "restriction" } }, rules),
    ).toBe(true);
    expect(
      relationMatchesExtractTagRules({ id: 2, members: [], tags: { type: "route" } }, rules),
    ).toBe(false);
  });

  test("single highway way rule excludes other tags", () => {
    const rules = normalizeTagFilterRules({
      nodes: [],
      ways: [{ key: "highway" }],
      relations: [],
    });
    expect(wayMatchesExtractTagRules({ id: 1, refs: [], tags: { highway: "road" } }, rules)).toBe(
      true,
    );
    expect(
      wayMatchesExtractTagRules({ id: 2, refs: [], tags: { public_transport: "platform" } }, rules),
    ).toBe(false);
  });
});
