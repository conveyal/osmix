/**
 * Replace base geometry (MP-R2): find imported ways that trace base ways. Replacing deletes the
 * base ways and keeps the imported ways, each with its own ID, geometry and tags (the base tags
 * it lacks are filled in), so every imported entity is in the result.
 *
 * A group is one imported way against a chain of base ways, or one base way against a chain of
 * imported ways (one-to-one is both). Each side must lie within the tolerance of the other.
 * The base nodes other data depends on (the chain's ends and joins, junctions with other ways,
 * and tagged points) are anchors: each takes the place of an imported vertex within the
 * tolerance, or is spliced into the imported line, and keeps its own position, so the ways that
 * met the base ways meet the imported ways. The base ways' other nodes are released.
 */
import { haversineDistance } from "@osmix/geo/haversine-distance";
import type { LonLat, OsmTags, OsmWay } from "@osmix/types";

import { isAreaWay } from "../rules/area.ts";
import { routingGradeSignature } from "../rules/grade.ts";
import { lineBbox, pointLineDistance, sampleLine } from "../rules/line-geometry.ts";
import { assessNodeTags, mergeImportedTags } from "../rules/node-identity.ts";
import { familyCompatible, wayRoutingFamily } from "../rules/routing.ts";
import type { DatasetView } from "../views.ts";

/** Why a group cannot be replaced as it stands. */
type WayReplacementReason =
  | "replacement-direction-ambiguous"
  | "replacement-end-unpaired"
  | "replacement-anchor-unpaired"
  | "replacement-anchor-shared"
  | "replacement-restriction"
  | "replacement-relation-member"
  | "replacement-duplicate-node"
  | "routing-family-conflict";

/** An imported and a base chain that trace each other, and what replacing would do. */
export interface WayReplacementGroup {
  /** `replace:w<imported…>>w<base…>`, in chain order. */
  id: string;
  /** The imported ways that are kept, in chain order. */
  importedWayIds: number[];
  /** The base ways that are deleted, in chain order; their relation memberships move over. */
  baseWayIds: number[];
  status: "review" | "blocked";
  /** Why the group cannot be replaced; empty unless blocked. */
  reasons: WayReplacementReason[];
  /**
   * What only a person may decide, even when an automation level would otherwise: `grade-change`
   * when a kept way or an anchor's merged tags are on another grade (layer, level, bridge, tunnel,
   * covered) than the base way or node they stand in for.
   */
  reviewReasons: "grade-change"[];
  /**
   * Base nodes that stay, each with the imported vertex it takes the place of, or `spliced` when
   * it is inserted into the imported line between vertices.
   */
  anchors: { baseNodeId: number; importedNodeId: number | null; spliced?: true }[];
  /** Base nodes that take the tags of the imported vertex they replace; imported values win. */
  mergedTags: { nodeId: number; tags: OsmTags }[];
  /**
   * The tags each imported way keeps: its own, with the base tags it lacks filled in (those every
   * replaced base way agrees on, and direction-relative ones only when it runs the same way).
   */
  wayTags: { wayId: number; tags: OsmTags }[];
  /** The refs each imported way keeps, in its own direction, with anchors in place. */
  refs: { wayId: number; refs: number[] }[];
  /** Base nodes the deleted base ways no longer use. */
  releasedNodeIds: number[];
}

/** Imported and base ways that overlap without forming a group, and why. */
interface WayReplacementMiss {
  importedWayIds: number[];
  baseWayIds: number[];
  reason: "many-to-many" | "not-covered" | "not-a-chain";
}

export interface WayReplacementDiscovery {
  groups: WayReplacementGroup[];
  misses: WayReplacementMiss[];
}

const isLine = (way: OsmWay) =>
  way.refs.length >= 2 &&
  new Set(way.refs).size === way.refs.length &&
  way.tags?.["highway"] != null &&
  !isAreaWay(way);

/** Whether every sampled point of `line` lies within `tolerance` of one of `lines`. */
function coveredBy(
  line: readonly LonLat[],
  lines: readonly (readonly LonLat[])[],
  tolerance: number,
) {
  return sampleLine(line).every((point) =>
    lines.some((other) => pointLineDistance(point, other) <= tolerance),
  );
}

/** Union-find over `i<id>` and `b<id>` keys. */
class Components {
  private readonly parent = new Map<string, string>();
  find(key: string): string {
    let root = this.parent.get(key) ?? key;
    if (root !== key) root = this.find(root);
    this.parent.set(key, root);
    return root;
  }
  union(a: string, b: string) {
    this.parent.set(this.find(a), this.find(b));
  }
  groups() {
    const result = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      result.set(root, [...(result.get(root) ?? []), key]);
    }
    return [...result.values()];
  }
}

/**
 * Order ways that join end to end into one chain, each with the direction it runs in the
 * chain, or null when they do not form a single unbranched chain.
 */
function chainOrder(ways: readonly OsmWay[]): { way: OsmWay; reversed: boolean }[] | null {
  if (ways.length === 1) return [{ way: ways[0]!, reversed: false }];
  const byEnd = new Map<number, OsmWay[]>();
  for (const way of ways)
    for (const end of [way.refs[0]!, way.refs.at(-1)!])
      byEnd.set(end, [...(byEnd.get(end) ?? []), way]);
  if ([...byEnd.values()].some((at) => at.length > 2)) return null;
  const ends = [...byEnd].filter(([, at]) => at.length === 1);
  if (ends.length !== 2) return null;
  let node = Math.min(ends[0]![0], ends[1]![0]);
  const ordered: { way: OsmWay; reversed: boolean }[] = [];
  const used = new Set<number>();
  while (ordered.length < ways.length) {
    const next = byEnd.get(node)?.find((way) => !used.has(way.id));
    if (!next) return null;
    const reversed = next.refs[0] !== node;
    ordered.push({ way: next, reversed });
    used.add(next.id);
    node = reversed ? next.refs[0]! : next.refs.at(-1)!;
  }
  return ordered;
}

/** The chain's node IDs in order, each shared node once. */
function chainRefs(chain: readonly { way: OsmWay; reversed: boolean }[]) {
  const refs: number[] = [];
  for (const { way, reversed } of chain) {
    const ordered = reversed ? way.refs.toReversed() : way.refs;
    refs.push(...(refs.length ? ordered.slice(1) : ordered));
  }
  return refs;
}

/**
 * Find replacement groups between imported (`patch`) and base ways, within `tolerance` meters.
 * Discovery reads only geometry and topology; nothing changes.
 */
export function discoverWayReplacements(
  baseView: DatasetView,
  patchView: DatasetView,
  tolerance: number,
): WayReplacementDiscovery {
  const components = new Components();
  const lines = new Map<string, LonLat[]>();
  const ways = new Map<string, OsmWay>();
  const contains = new Set<string>();
  const remember = (key: string, way: OsmWay, view: DatasetView) => {
    if (!lines.has(key)) {
      lines.set(key, view.wayCoordinates(way));
      ways.set(key, way);
    }
    return lines.get(key)!;
  };
  for (const imported of patchView.ways()) {
    if (!isLine(imported)) continue;
    const importedKey = `i${imported.id}`;
    const importedLine = remember(importedKey, imported, patchView);
    if (importedLine.length < 2) continue;
    for (const base of baseView.waysIntersecting(lineBbox(importedLine, tolerance))) {
      if (!isLine(base) || patchView.getWay(base.id)) continue;
      const baseKey = `b${base.id}`;
      const baseLine = remember(baseKey, base, baseView);
      if (baseLine.length < 2) continue;
      const baseInside = coveredBy(baseLine, [importedLine], tolerance);
      const importedInside = coveredBy(importedLine, [baseLine], tolerance);
      if (!baseInside && !importedInside) continue;
      if (baseInside) contains.add(`${baseKey}<${importedKey}`);
      if (importedInside) contains.add(`${importedKey}<${baseKey}`);
      components.union(importedKey, baseKey);
    }
  }

  const groups: WayReplacementGroup[] = [];
  const misses: WayReplacementMiss[] = [];
  for (const keys of components.groups()) {
    const importedKeys = keys.filter((key) => key.startsWith("i")).toSorted();
    const baseKeys = keys.filter((key) => key.startsWith("b")).toSorted();
    const ids = (group: string[]) => group.map((key) => Number(key.slice(1)));
    const miss = (reason: WayReplacementMiss["reason"]) =>
      misses.push({ importedWayIds: ids(importedKeys), baseWayIds: ids(baseKeys), reason });
    if (importedKeys.length > 1 && baseKeys.length > 1) {
      miss("many-to-many");
      continue;
    }
    // The single way on one side must be covered by the chain on the other, and every way in
    // that chain must lie along the single way.
    const [single, many] =
      importedKeys.length === 1 ? [importedKeys[0]!, baseKeys] : [baseKeys[0]!, importedKeys];
    const covered =
      many.every((key) => contains.has(`${key}<${single}`)) &&
      coveredBy(
        lines.get(single)!,
        many.map((key) => lines.get(key)!),
        tolerance,
      );
    if (!covered) {
      miss("not-covered");
      continue;
    }
    const importedChain = chainOrder(importedKeys.map((key) => ways.get(key)!));
    const baseChain = chainOrder(baseKeys.map((key) => ways.get(key)!));
    if (!importedChain || !baseChain) {
      miss("not-a-chain");
      continue;
    }
    groups.push(assessGroup(baseView, patchView, importedChain, baseChain, tolerance));
  }
  blockInconsistentAnchors(groups);
  groups.sort((a, b) => a.id.localeCompare(b.id));
  return { groups, misses };
}

type Chain = { way: OsmWay; reversed: boolean }[];

/**
 * Groups that meet at a base junction or an imported vertex must pair it the same way, since
 * applying one group's pairing rewrites every way at the vertex. Block every group that pairs a
 * shared point differently from another.
 */
function blockInconsistentAnchors(groups: WayReplacementGroup[]) {
  const byBase = new Map<number, Set<string>>();
  const byImported = new Map<number, Set<string>>();
  const groupsAt = new Map<string, WayReplacementGroup[]>();
  const add = (
    map: Map<number, Set<string>>,
    id: number,
    pairing: string,
    group: WayReplacementGroup,
  ) => {
    map.set(id, (map.get(id) ?? new Set()).add(pairing));
    const key = `${map === byBase ? "b" : "i"}${id}`;
    groupsAt.set(key, [...(groupsAt.get(key) ?? []), group]);
  };
  for (const group of groups) {
    for (const { baseNodeId, importedNodeId } of group.anchors) {
      add(byBase, baseNodeId, String(importedNodeId), group);
      if (importedNodeId != null) add(byImported, importedNodeId, String(baseNodeId), group);
    }
  }
  for (const [map, prefix] of [
    [byBase, "b"],
    [byImported, "i"],
  ] as const) {
    for (const [id, pairings] of map) {
      if (pairings.size < 2) continue;
      for (const group of groupsAt.get(`${prefix}${id}`) ?? []) {
        if (group.reasons.includes("replacement-anchor-shared")) continue;
        group.reasons = [...group.reasons, "replacement-anchor-shared" as const].toSorted();
        group.status = "blocked";
      }
    }
  }
}

/** Tag keys whose meaning depends on which way the way runs. */
function isDirectionRelative(key: string) {
  return (
    key === "oneway" ||
    key === "incline" ||
    key.startsWith("oneway:") ||
    key
      .split(":")
      .some((part) => ["forward", "backward", "left", "right", "direction"].includes(part))
  );
}

/**
 * The base tags every way of the chain agrees on, which a kept imported way inherits when it
 * lacks them. Direction-relative keys are left out unless the imported way runs the same way.
 */
function baseTagsAgreed(chain: Chain, sameDirection: boolean): OsmTags {
  const [first, ...rest] = chain.map(({ way }) => way.tags ?? {});
  const agreed: OsmTags = {};
  for (const [key, value] of Object.entries(first ?? {})) {
    if (!sameDirection && isDirectionRelative(key)) continue;
    if (rest.every((tags) => tags[key] === value)) agreed[key] = value;
  }
  return agreed;
}

/** How far `point` is from a segment, in meters, and how far along it (0–1) the nearest point is. */
function projectOnSegment(point: LonLat, start: LonLat, end: LonLat) {
  const xScale = 111_320 * Math.cos((point[1] * Math.PI) / 180);
  const yScale = 110_574;
  const ax = (start[0] - point[0]) * xScale;
  const ay = (start[1] - point[1]) * yScale;
  const dx = (end[0] - start[0]) * xScale;
  const dy = (end[1] - start[1]) * yScale;
  const length = dx * dx + dy * dy;
  const along = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
  return { distance: Math.hypot(ax + along * dx, ay + along * dy), along };
}

/** Integers from `start` up to, not including, `end`. */
const range = (start: number, end: number) =>
  Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);

function assessGroup(
  baseView: DatasetView,
  patchView: DatasetView,
  importedChain: Chain,
  baseChain: Chain,
  tolerance: number,
): WayReplacementGroup {
  const reasons = new Set<WayReplacementReason>();
  const reviewReasons = new Set<"grade-change">();
  const importedWayIds = importedChain.map(({ way }) => way.id);
  const baseWayIds = baseChain.map(({ way }) => way.id);
  const baseRefs = chainRefs(baseChain);
  let importedRefs = chainRefs(importedChain);
  const baseNode = (id: number) => baseView.getNode(id);
  const importedNode = (id: number) => patchView.getNode(id) ?? baseView.getNode(id);
  const at = (node: { lon: number; lat: number } | null | undefined): LonLat | null =>
    node ? [node.lon, node.lat] : null;
  const meters = (a: LonLat | null, b: LonLat | null) =>
    a && b ? haversineDistance(a, b) : Number.POSITIVE_INFINITY;

  // Run the imported chain the same way as the base chain.
  const baseStart = at(baseNode(baseRefs[0]!));
  const baseEnd = at(baseNode(baseRefs.at(-1)!));
  const importedStart = at(importedNode(importedRefs[0]!));
  const importedEnd = at(importedNode(importedRefs.at(-1)!));
  const forward = Math.max(meters(baseStart, importedStart), meters(baseEnd, importedEnd));
  const backward = Math.max(meters(baseStart, importedEnd), meters(baseEnd, importedStart));
  if (baseRefs[0] === baseRefs.at(-1) || Math.abs(forward - backward) < 1e-6) {
    reasons.add("replacement-direction-ambiguous");
  }
  if (backward < forward) importedRefs = importedRefs.toReversed();

  // Anchors: the chain's ends and joins, junctions with other ways, and tagged points.
  const chainWays = new Set(baseWayIds);
  const joins = new Set(
    baseChain.slice(1).map(({ way, reversed }) => (reversed ? way.refs.at(-1)! : way.refs[0]!)),
  );
  const membership = baseView.relationMembership();
  const anchorIndexes: number[] = [];
  baseRefs.forEach((id, index) => {
    const end = index === 0 || index === baseRefs.length - 1;
    const junction = baseView.waysAtNode(id).some((way) => !chainWays.has(way.id));
    const tagged = Object.keys(baseNode(id)?.tags ?? {}).length > 0;
    if (end || joins.has(id) || junction || tagged) anchorIndexes.push(index);
    if (membership.restrictionNodes.has(id)) reasons.add("replacement-restriction");
  });
  for (const id of baseWayIds)
    if (membership.restrictionWays.has(id)) reasons.add("replacement-restriction");
  const importedMembership = patchView.relationMembership();

  // Pair each anchor, in order along the imported chain, with the nearest imported vertex after
  // the previous one; failing that, splice it into the nearest point of the line. Positions are
  // vertex indexes, fractional between vertices for a splice. The chains' ends pair end to end.
  const anchors: WayReplacementGroup["anchors"] = [];
  const mergedTags: WayReplacementGroup["mergedTags"] = [];
  const placed: { id: number; position: number }[] = [];
  let previous = -1;
  const lastVertex = importedRefs.length - 1;
  const importedPoint = (vertex: number) => at(importedNode(importedRefs[vertex]!));
  for (const [order, index] of anchorIndexes.entries()) {
    const id = baseRefs[index]!;
    const point = at(baseNode(id));
    const first = order === 0;
    const last = order === anchorIndexes.length - 1;
    const vertices = first ? [0] : last ? [lastVertex] : range(previous + 1, lastVertex);
    let position = -1;
    let nearest = Number.POSITIVE_INFINITY;
    for (const vertex of vertices) {
      const distance = meters(point, importedPoint(vertex));
      if (distance <= tolerance && distance < nearest) {
        position = vertex;
        nearest = distance;
      }
    }
    if (position === -1 && !first && !last && point) {
      for (let segment = Math.max(0, Math.floor(previous)); segment < lastVertex; segment++) {
        const start = importedPoint(segment);
        const end = importedPoint(segment + 1);
        if (!start || !end) continue;
        const { distance, along } = projectOnSegment(point, start, end);
        const spot = segment + along;
        if (
          spot > previous &&
          along > 0 &&
          along < 1 &&
          distance <= tolerance &&
          distance < nearest
        ) {
          position = spot;
          nearest = distance;
        }
      }
    }
    if (position === -1) {
      reasons.add(first || last ? "replacement-end-unpaired" : "replacement-anchor-unpaired");
      anchors.push({ baseNodeId: id, importedNodeId: null });
      continue;
    }
    previous = position;
    placed.push({ id, position });
    if (!Number.isInteger(position)) {
      anchors.push({ baseNodeId: id, importedNodeId: null, spliced: true });
      continue;
    }
    const importedId = importedRefs[position]!;
    anchors.push({ baseNodeId: id, importedNodeId: importedId });
    // The anchor takes the imported vertex's place, deleting it.
    if (importedId !== id && importedMembership.nodes.has(importedId)) {
      reasons.add("replacement-relation-member");
    }
    const importedTags = importedNode(importedId)?.tags;
    if (importedId === id || Object.keys(importedTags ?? {}).length === 0) continue;
    // The base node takes the imported vertex's place, and its tags, as an identical point would.
    const baseTags = baseNode(id)?.tags;
    const { reviewReasons: nodeReview } = assessNodeTags("exact", importedTags, baseTags, {
      sourceIsImported: true,
    });
    if (nodeReview.includes("grade-change")) reviewReasons.add("grade-change");
    mergedTags.push({ nodeId: id, tags: mergeImportedTags(baseTags, importedTags) });
  }

  // The chains must be the same kind of way.
  for (const { way: imported } of importedChain)
    for (const { way: base } of baseChain)
      if (!familyCompatible(wayRoutingFamily(imported), wayRoutingFamily(base)))
        reasons.add("routing-family-conflict");

  // The replaced line in base order: imported vertices, paired anchors in their place, spliced
  // anchors between. Each imported way keeps the stretch between its own ends.
  const refs: WayReplacementGroup["refs"] = [];
  const wayTags: WayReplacementGroup["wayTags"] = [];
  const kept = new Set(anchors.map(({ baseNodeId }) => baseNodeId));
  if (!reasons.has("replacement-end-unpaired") && !reasons.has("replacement-anchor-unpaired")) {
    const byVertex = new Map(
      placed
        .filter(({ position }) => Number.isInteger(position))
        .map(({ id, position }) => [position, id]),
    );
    const line = [
      ...importedRefs.map((id, vertex) => ({ id: byVertex.get(vertex) ?? id, position: vertex })),
      ...placed.filter(({ position }) => !Number.isInteger(position)),
    ].toSorted((a, b) => a.position - b.position);
    const lineDirection = baseChain.map(({ reversed }) => !reversed);
    for (const { way } of importedChain) {
      const first = importedRefs.indexOf(way.refs[0]!);
      const last = importedRefs.lastIndexOf(way.refs.at(-1)!);
      const forward = first < last;
      const [from, to] = forward ? [first, last] : [last, first];
      const stretch = line
        .filter(({ position }) => position >= from && position <= to)
        .map(({ id }) => id);
      const next = forward ? stretch : stretch.toReversed();
      if (new Set(next).size !== next.length) reasons.add("replacement-duplicate-node");
      refs.push({ wayId: way.id, refs: next });
      // The imported way runs the same way as every base way when the line direction it follows
      // matches each base way's own.
      const sameDirection = lineDirection.every((alongLine) => alongLine === forward);
      const tags = { ...baseTagsAgreed(baseChain, sameDirection), ...way.tags };
      if (
        baseChain.some(
          ({ way: base }) => routingGradeSignature(base.tags) !== routingGradeSignature(tags),
        )
      ) {
        reviewReasons.add("grade-change");
      }
      wayTags.push({ wayId: way.id, tags });
    }
  }
  const releasedNodeIds = baseRefs.filter((id) => !kept.has(id));
  for (const id of releasedNodeIds)
    if (membership.nodes.has(id)) reasons.add("replacement-relation-member");

  const token = (ids: number[]) => ids.map((id) => `w${id}`).join(",");
  return {
    id: `replace:${token(importedWayIds)}>${token(baseWayIds)}`,
    importedWayIds,
    baseWayIds,
    status: reasons.size > 0 ? "blocked" : "review",
    reasons: [...reasons].toSorted(),
    reviewReasons: [...reviewReasons],
    anchors,
    mergedTags,
    wayTags,
    refs,
    releasedNodeIds,
  };
}
