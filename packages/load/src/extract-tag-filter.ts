/**
 * Serializable tag rules for PBF ingestion (safe to pass through workers).
 *
 * @module
 */

import type { OsmNode, OsmRelation, OsmTags, OsmWay } from "@osmix/shared/types";

/** A single tag key/value rule. Empty or omitted `value` matches any value for `key`. */
export interface ExtractTagFilterRule {
  key: string;
  value?: string;
}

/** Per-entity-type tag filter rule lists. */
export interface ExtractTagFilterRules {
  nodes: ExtractTagFilterRule[];
  ways: ExtractTagFilterRule[];
  relations: ExtractTagFilterRule[];
}

/** Conveyal default extract tag filters (transit / RO oriented). */
export const CONVEYAL_EXTRACT_TAG_FILTERS: ExtractTagFilterRules = {
  nodes: [],
  ways: [
    { key: "highway" },
    { key: "public_transport", value: "platform" },
    { key: "railway", value: "platform" },
    { key: "park_ride" },
  ],
  relations: [{ key: "type", value: "restriction" }],
};

function normalizeRuleList(rules: ExtractTagFilterRule[]): ExtractTagFilterRule[] {
  return rules
    .map((rule) => {
      const key = rule.key.trim();
      if (!key) return null;
      const value = rule.value?.trim();
      return value ? { key, value } : { key };
    })
    .filter((rule): rule is ExtractTagFilterRule => rule !== null);
}

/** Trim keys, drop blank keys, normalize empty values to "any value". */
export function normalizeTagFilterRules(rules: ExtractTagFilterRules): ExtractTagFilterRules {
  return {
    nodes: normalizeRuleList(rules.nodes),
    ways: normalizeRuleList(rules.ways),
    relations: normalizeRuleList(rules.relations),
  };
}

/** True when any entity section has at least one rule after normalization. */
export function hasExtractTagFilter(rules: ExtractTagFilterRules): boolean {
  const n = normalizeTagFilterRules(rules);
  return n.nodes.length > 0 || n.ways.length > 0 || n.relations.length > 0;
}

/** Whether a single rule matches entity tags. */
export function tagRuleMatches(tags: OsmTags | undefined, rule: ExtractTagFilterRule): boolean {
  if (!tags) return false;
  if (!(rule.key in tags)) return false;
  if (rule.value === undefined) return true;
  return tags[rule.key] === rule.value;
}

/**
 * Match semantics for a rule list:
 * - 0 rules: no tag gate (pass)
 * - 1 rule: must match
 * - 2+ rules: match any (OR)
 */
export function entityMatchesTagRules(
  tags: OsmTags | undefined,
  rules: ExtractTagFilterRule[],
): boolean {
  const normalized = normalizeRuleList(rules);
  if (normalized.length === 0) return true;
  if (normalized.length === 1) return tagRuleMatches(tags, normalized[0]!);
  return normalized.some((rule) => tagRuleMatches(tags, rule));
}

export function nodeMatchesExtractTagRules(node: OsmNode, rules: ExtractTagFilterRules): boolean {
  return entityMatchesTagRules(node.tags, rules.nodes);
}

export function wayMatchesExtractTagRules(way: OsmWay, rules: ExtractTagFilterRules): boolean {
  return entityMatchesTagRules(way.tags, rules.ways);
}

export function relationMatchesExtractTagRules(
  relation: OsmRelation,
  rules: ExtractTagFilterRules,
): boolean {
  return entityMatchesTagRules(relation.tags, rules.relations);
}
