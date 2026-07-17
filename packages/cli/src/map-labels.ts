import { clipPolyline } from "@osmix/geo/lineclip";
import { wayIsArea } from "@osmix/geo/way-is-area";
import {
  matchTags,
  type PlaceKind,
  type ShortbreadGeometryType,
  type ShortbreadLayerName,
  type ShortbreadProperties,
  type StreetKind,
  type WaterKind,
  type WaterLineKind,
} from "@osmix/shortbread";
import type { GeoBbox2D, LonLat, Osm, OsmTags } from "osmix";

import { MapCamera, type MapViewport, type ScreenPoint } from "./camera.ts";
import { semanticPointCategory } from "./map-style.ts";

export type MapLabelKind = "place" | "poi" | "road" | "site" | "water";

type LabelPlacement = "center" | "point";

export interface MapLabelMetadata {
  kind: MapLabelKind;
  placement: LabelPlacement;
  priority: number;
  text: string;
}

/** Worker-side classification retained by the semantic label index. */
export interface IndexedMapLabelMetadata extends MapLabelMetadata {
  minZoom: number;
}

export interface MapLabelCandidate extends MapLabelMetadata {
  anchor: ScreenPoint;
  stableKey: string;
  visibleLength: number;
}

export interface MeasuredLabelText {
  text: string;
  width: number;
}

export interface PlacedMapLabel extends MeasuredLabelText {
  backplateWidth: number;
  backplateX: number;
  kind: MapLabelKind;
  x: number;
  y: number;
}

export type LabelTextMeasurer = (text: string, maxWidth: number) => MeasuredLabelText | null;

interface LabelRule {
  kind: MapLabelKind;
  minZoom: number;
  placement: LabelPlacement;
  priority: number;
}

interface AnchoredGeometry {
  anchor: ScreenPoint;
  visibleLength: number;
}

/** A preclassified semantic node supplied by the worker-owned point index. */
export interface IndexedMapLabelNode {
  coordinate: LonLat;
  id: number;
  metadata: IndexedMapLabelMetadata;
}

export interface MapLabelSpatialIndexProvider {
  intersects(bbox: GeoBbox2D): Iterable<number>;
}

export interface CollectMapLabelCandidateOptions {
  nodes?: Iterable<IndexedMapLabelNode>;
  relations?: MapLabelSpatialIndexProvider;
  ways?: MapLabelSpatialIndexProvider;
}

interface CollisionBox {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

const MAX_LABEL_WIDTH = 24;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function normalizedText(value: string | undefined): string | null {
  const text = value?.trim().replace(/\s+/g, " ");
  return text ? text : null;
}

/** Truncate text using OpenTUI-provided terminal widths for each grapheme. */
export function truncateLabelText(
  text: string,
  graphemeWidths: number[],
  maxWidth: number,
): MeasuredLabelText | null {
  const width = graphemeWidths.reduce((total, graphemeWidth) => total + graphemeWidth, 0);
  if (width <= maxWidth) return width > 0 ? { text, width } : null;

  const graphemes = [...GRAPHEME_SEGMENTER.segment(text)].map((segment) => segment.segment);
  const contentWidth = Math.max(0, maxWidth - 1);
  let truncated = "";
  let truncatedWidth = 0;
  for (const [index, graphemeWidth] of graphemeWidths.entries()) {
    if (truncatedWidth + graphemeWidth > contentWidth) break;
    truncated += graphemes[index] ?? "";
    truncatedWidth += graphemeWidth;
  }
  return truncated ? { text: `${truncated}…`, width: truncatedWidth + 1 } : null;
}

function labelText(properties: ShortbreadProperties, allowRef: boolean): string | null {
  return (
    normalizedText(properties.name) ??
    normalizedText(properties.name_en) ??
    (allowRef && "ref" in properties ? normalizedText(properties.ref) : null)
  );
}

function placeMinZoom(kind: PlaceKind): number {
  if (["continent", "country", "state", "city"].includes(kind)) return 4;
  if (kind === "town") return 7;
  if (kind === "village") return 9;
  if (kind === "suburb") return 10;
  if (kind === "hamlet" || kind === "neighbourhood") return 12;
  return 13;
}

function placePriority(kind: PlaceKind): number {
  if (kind === "continent" || kind === "country") return 1_050;
  if (kind === "state" || kind === "city") return 1_040;
  if (kind === "town") return 1_030;
  if (kind === "village") return 1_020;
  if (kind === "suburb") return 1_010;
  return 1_000;
}

function roadRule(kind: StreetKind): LabelRule | null {
  if (["motorway", "motorway_link", "trunk", "trunk_link"].includes(kind)) {
    return { kind: "road", minZoom: 9, placement: "center", priority: 940 };
  }
  if (kind === "primary" || kind === "primary_link") {
    return { kind: "road", minZoom: 9, placement: "center", priority: 930 };
  }
  if (kind === "secondary" || kind === "secondary_link") {
    return { kind: "road", minZoom: 10, placement: "center", priority: 920 };
  }
  if (kind === "tertiary" || kind === "tertiary_link") {
    return { kind: "road", minZoom: 11, placement: "center", priority: 840 };
  }
  if (kind === "residential" || kind === "unclassified") {
    return { kind: "road", minZoom: 12, placement: "center", priority: 830 };
  }
  if (kind === "service" || kind === "living_street" || kind === "pedestrian") {
    return { kind: "road", minZoom: 14, placement: "center", priority: 820 };
  }
  if (["track", "footway", "path", "cycleway", "steps", "bridleway"].includes(kind)) {
    return { kind: "road", minZoom: 15, placement: "center", priority: 810 };
  }
  return null;
}

function waterAreaRule(kind: WaterKind): LabelRule {
  const minor = kind === "dock" || kind === "swimming_pool";
  return { kind: "water", minZoom: minor ? 13 : 8, placement: "center", priority: 880 };
}

function waterLineRule(kind: WaterLineKind): LabelRule {
  const major = kind === "river" || kind === "canal";
  return { kind: "water", minZoom: major ? 10 : 13, placement: "center", priority: 870 };
}

function ruleForMatch(
  layer: ShortbreadLayerName,
  properties: ShortbreadProperties,
): LabelRule | null {
  switch (layer) {
    case "places": {
      const kind = properties.kind as PlaceKind;
      return {
        kind: "place",
        minZoom: placeMinZoom(kind),
        placement: "center",
        priority: placePriority(kind),
      };
    }
    case "street_labels":
      return roadRule(properties.kind as StreetKind);
    case "water":
      return waterAreaRule(properties.kind as WaterKind);
    case "water_lines_labels":
      return waterLineRule(properties.kind as WaterLineKind);
    case "sites":
      return { kind: "site", minZoom: 12, placement: "center", priority: 700 };
    case "pois": {
      const category = semanticPointCategory(properties.kind);
      if (!category) return null;
      return {
        kind: "poi",
        minZoom: category === "food" ? 15 : 14,
        placement: "point",
        priority: 600,
      };
    }
    default:
      return null;
  }
}

/** Resolve one preferred label classification for tagged geometry at a zoom level. */
export function resolveLabelMetadata(
  tags: OsmTags,
  geometryType: ShortbreadGeometryType,
  zoom: number,
): MapLabelMetadata | null {
  const indexed = resolveIndexedLabelMetadata(tags, geometryType, zoom);
  if (!indexed) return null;
  const { minZoom: _minZoom, ...metadata } = indexed;
  return metadata;
}

/** Resolve label metadata while retaining its minimum zoom for worker-side indexing. */
export function resolveIndexedLabelMetadata(
  tags: OsmTags,
  geometryType: ShortbreadGeometryType,
  zoom = Number.POSITIVE_INFINITY,
): IndexedMapLabelMetadata | null {
  let best: IndexedMapLabelMetadata | null = null;
  for (const match of matchTags(tags, geometryType)) {
    const rule = ruleForMatch(match.layer.name, match.properties);
    if (!rule || zoom < rule.minZoom) continue;
    const text = labelText(match.properties, rule.kind === "road");
    if (!text) continue;
    const metadata = {
      kind: rule.kind,
      minZoom: rule.minZoom,
      placement: rule.placement,
      priority: rule.priority,
      text,
    };
    if (!best || metadata.priority > best.priority) best = metadata;
  }
  return best;
}

function visibleIndexes(
  bboxes: GeoBbox2D[],
  search: (bbox: GeoBbox2D) => Iterable<number>,
): number[] {
  const indexes = new Set<number>();
  for (const bbox of bboxes) {
    for (const index of search(bbox)) indexes.add(index);
  }
  return [...indexes];
}

function lineLength(points: ScreenPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
  }
  return length;
}

function lineMidpoint(points: ScreenPoint[], totalLength: number): ScreenPoint {
  let remaining = totalLength / 2;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    const segmentLength = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (remaining <= segmentLength) {
      const fraction = segmentLength === 0 ? 0 : remaining / segmentLength;
      return {
        x: previous.x + (point.x - previous.x) * fraction,
        y: previous.y + (point.y - previous.y) * fraction,
      };
    }
    remaining -= segmentLength;
  }
  return points.at(-1)!;
}

function visibleLineAnchor(
  lineStrings: LonLat[][],
  camera: MapCamera,
  viewport: MapViewport,
): AnchoredGeometry | null {
  let best: AnchoredGeometry | null = null;
  const clipBbox: [number, number, number, number] = [0, 0, viewport.width, viewport.height];
  for (const lineString of lineStrings) {
    const projected = lineString.map((coordinate) => camera.project(coordinate, viewport));
    const clipped = clipPolyline(
      projected.map((point) => [point.x, point.y]),
      clipBbox,
    );
    for (const segment of clipped) {
      const points = segment.map(([x, y]) => ({ x, y }));
      const visibleLength = lineLength(points);
      if (points.length < 2 || visibleLength === 0) continue;
      if (!best || visibleLength > best.visibleLength) {
        best = { anchor: lineMidpoint(points, visibleLength), visibleLength };
      }
    }
  }
  return best;
}

function polygonAnchor(
  polygons: LonLat[][][],
  camera: MapCamera,
  viewport: MapViewport,
): AnchoredGeometry | null {
  let best: AnchoredGeometry | null = null;
  for (const polygon of polygons) {
    const outerRing = polygon[0];
    if (!outerRing || outerRing.length === 0) continue;
    const points = outerRing.map((coordinate) => camera.project(coordinate, viewport));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const area = (maxX - minX) * (maxY - minY);
    if (!best || area > best.visibleLength) {
      best = {
        anchor: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        visibleLength: area,
      };
    }
  }
  return best;
}

function addCandidate(
  candidates: MapLabelCandidate[],
  metadata: MapLabelMetadata | null,
  geometry: AnchoredGeometry | null,
  stableKey: string,
): boolean {
  if (!metadata || !geometry) return false;
  candidates.push({ ...metadata, ...geometry, stableKey });
  return true;
}

function preferredCandidate(
  current: MapLabelCandidate,
  candidate: MapLabelCandidate,
): MapLabelCandidate {
  if (candidate.priority !== current.priority) {
    return candidate.priority > current.priority ? candidate : current;
  }
  if (candidate.visibleLength !== current.visibleLength) {
    return candidate.visibleLength > current.visibleLength ? candidate : current;
  }
  return candidate.stableKey < current.stableKey ? candidate : current;
}

function deduplicateLineLabels(candidates: MapLabelCandidate[]): MapLabelCandidate[] {
  const result: MapLabelCandidate[] = [];
  const lines = new Map<string, MapLabelCandidate>();
  for (const candidate of candidates) {
    if (candidate.kind !== "road" && candidate.kind !== "water") {
      result.push(candidate);
      continue;
    }
    const key = `${candidate.kind}:${candidate.text.toLocaleLowerCase()}`;
    const current = lines.get(key);
    lines.set(key, current ? preferredCandidate(current, candidate) : candidate);
  }
  result.push(...lines.values());
  return result;
}

/** Collect semantic label candidates for the current viewport. */
export function collectMapLabelCandidates(
  osm: Osm,
  camera: MapCamera,
  viewport: MapViewport,
  options: CollectMapLabelCandidateOptions = {},
): MapLabelCandidate[] {
  const bboxes = camera.visibleBboxes(viewport);
  const candidates: MapLabelCandidate[] = [];
  const suppressedAreaWayIds = new Set<number>();

  const relationIndex = options.relations ?? osm.relations;
  for (const index of visibleIndexes(bboxes, (bbox) => relationIndex.intersects(bbox))) {
    const relation = osm.relations.getByIndex(index);
    if (!relation?.tags) continue;
    const polygonMetadata = resolveLabelMetadata(relation.tags, "Polygon", camera.zoom);
    const lineMetadata = resolveLabelMetadata(relation.tags, "LineString", camera.zoom);
    const pointMetadata = resolveLabelMetadata(relation.tags, "Point", camera.zoom);
    if (!polygonMetadata && !lineMetadata && !pointMetadata) continue;
    const geometry = osm.relations.getRelationGeometry(index);
    if (geometry.rings && polygonMetadata) {
      const added = addCandidate(
        candidates,
        polygonMetadata,
        polygonAnchor(geometry.rings, camera, viewport),
        `relation:${relation.id}:polygon`,
      );
      if (added) {
        for (const member of relation.members) {
          if (member.type === "way") suppressedAreaWayIds.add(member.ref);
        }
      }
    }
    if (geometry.lineStrings && lineMetadata) {
      addCandidate(
        candidates,
        lineMetadata,
        visibleLineAnchor(geometry.lineStrings, camera, viewport),
        `relation:${relation.id}:line`,
      );
    }
    if (geometry.points && pointMetadata) {
      for (const [pointIndex, point] of geometry.points.entries()) {
        addCandidate(
          candidates,
          pointMetadata,
          { anchor: camera.project(point, viewport), visibleLength: 0 },
          `relation:${relation.id}:point:${pointIndex}`,
        );
      }
    }
  }

  const wayIndex = options.ways ?? osm.ways;
  for (const index of visibleIndexes(bboxes, (bbox) => wayIndex.intersects(bbox))) {
    const way = osm.ways.getByIndex(index);
    if (!way?.tags) continue;
    const isArea = wayIsArea(way);
    if (isArea && suppressedAreaWayIds.has(way.id)) continue;
    const metadata = resolveLabelMetadata(way.tags, isArea ? "Polygon" : "LineString", camera.zoom);
    if (!metadata) continue;
    const coordinates = osm.ways.getCoordinates(index);
    if (isArea) {
      addCandidate(
        candidates,
        metadata,
        polygonAnchor([[coordinates]], camera, viewport),
        `way:${way.id}:polygon`,
      );
    } else {
      addCandidate(
        candidates,
        metadata,
        visibleLineAnchor([coordinates], camera, viewport),
        `way:${way.id}:line`,
      );
    }
  }

  if (options.nodes) {
    for (const node of options.nodes) {
      if (camera.zoom < node.metadata.minZoom) continue;
      const { minZoom: _minZoom, ...metadata } = node.metadata;
      addCandidate(
        candidates,
        metadata,
        { anchor: camera.project(node.coordinate, viewport), visibleLength: 0 },
        `node:${node.id}:point`,
      );
    }
  } else {
    for (const index of visibleIndexes(bboxes, (bbox) => osm.nodes.findIndexesWithinBbox(bbox))) {
      const tags = osm.nodes.tags.getTags(index);
      if (!tags) continue;
      const id = osm.nodes.ids.at(index);
      addCandidate(
        candidates,
        resolveLabelMetadata(tags, "Point", camera.zoom),
        {
          anchor: camera.project(osm.nodes.getNodeLonLat({ index }), viewport),
          visibleLength: 0,
        },
        `node:${id}:point`,
      );
    }
  }

  return deduplicateLineLabels(candidates);
}

function overlaps(a: CollisionBox, b: CollisionBox): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function placementXs(candidate: MapLabelCandidate, textWidth: number): number[] {
  const centerX = Math.round(candidate.anchor.x);
  if (candidate.placement === "point") {
    return [centerX + 2, centerX - textWidth - 2];
  }
  return [Math.round(candidate.anchor.x - textWidth / 2)];
}

/** Place measured labels into terminal cells using deterministic priority collisions. */
export function layoutMapLabels(
  candidates: MapLabelCandidate[],
  viewport: MapViewport,
  measureText: LabelTextMeasurer,
): PlacedMapLabel[] {
  const maxWidth = Math.min(MAX_LABEL_WIDTH, Math.max(0, viewport.width - 4));
  if (maxWidth === 0 || viewport.height === 0) return [];
  const acceptedBoxes: CollisionBox[] = [];
  const placed: PlacedMapLabel[] = [];
  const sorted = [...candidates].sort(
    (a, b) =>
      b.priority - a.priority ||
      b.visibleLength - a.visibleLength ||
      a.stableKey.localeCompare(b.stableKey),
  );

  for (const candidate of sorted) {
    const measured = measureText(candidate.text, maxWidth);
    if (!measured || measured.width <= 0) continue;
    const y = Math.floor(candidate.anchor.y / 2);
    if (y < 0 || y >= viewport.height) continue;
    for (const x of placementXs(candidate, measured.width)) {
      const backplateX = x - 1;
      const backplateWidth = measured.width + 2;
      if (backplateX < 0 || backplateX + backplateWidth > viewport.width) continue;
      const collisionBox = {
        left: backplateX - 1,
        right: backplateX + backplateWidth,
        top: y - 1,
        bottom: y + 1,
      };
      if (acceptedBoxes.some((box) => overlaps(box, collisionBox))) continue;
      acceptedBoxes.push(collisionBox);
      placed.push({
        ...measured,
        backplateWidth,
        backplateX,
        kind: candidate.kind,
        x,
        y,
      });
      break;
    }
  }
  return placed;
}
