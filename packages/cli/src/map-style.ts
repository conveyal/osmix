import {
  matchTags,
  type ShortbreadGeometryType,
  type ShortbreadLayerName,
  type ShortbreadProperties,
  type StreetKind,
} from "@osmix/shortbread";
import type { OsmTags, Rgba } from "osmix";

export type PointSymbol = "diamond" | "dot" | "plus" | "ring" | "square";
export type SemanticPointCategory = "civic" | "food" | "medical" | "recreation" | "transit";

interface BaseFeatureStyle {
  order: number;
}

export interface FillFeatureStyle extends BaseFeatureStyle {
  kind: "fill";
  color: Rgba;
  outlineColor?: Rgba;
  outlineWidth?: number;
}

export interface LineFeatureStyle extends BaseFeatureStyle {
  kind: "line";
  color: Rgba;
  width: number;
  casingColor?: Rgba;
  casingWidth?: number;
}

export interface PointFeatureStyle extends BaseFeatureStyle {
  kind: "point";
  color: Rgba;
  size: number;
  symbol: PointSymbol;
}

export type MapFeatureStyle = FillFeatureStyle | LineFeatureStyle | PointFeatureStyle;

function color(hex: string, alpha = 255): Rgba {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    alpha,
  ];
}

const FEATURE_LIGHTENING = 0.15;

function mapColor(hex: string, alpha = 255): Rgba {
  const base = color(hex, alpha);
  return [
    Math.round(base[0] + (255 - base[0]) * FEATURE_LIGHTENING),
    Math.round(base[1] + (255 - base[1]) * FEATURE_LIGHTENING),
    Math.round(base[2] + (255 - base[2]) * FEATURE_LIGHTENING),
    alpha,
  ];
}

export const DARK_MAP_COLORS = {
  background: color("#07110d"),
  water: mapColor("#143a52"),
  waterLine: mapColor("#4f91b3"),
  vegetation: mapColor("#183b2a"),
  grass: mapColor("#24492f"),
  agriculture: mapColor("#4a4227"),
  sand: mapColor("#655638"),
  urban: mapColor("#292d2c"),
  commercial: mapColor("#302d37"),
  industrial: mapColor("#333437"),
  site: mapColor("#2d3330"),
  building: mapColor("#444b47"),
  buildingOutline: mapColor("#626b65"),
  boundary: mapColor("#8d7097", 190),
  rail: mapColor("#9a8dac"),
  roadCasing: mapColor("#101713"),
  motorway: mapColor("#e47b67"),
  primary: mapColor("#df9c68"),
  secondary: mapColor("#d9b979"),
  tertiary: mapColor("#c8c09a"),
  residential: mapColor("#a8aea8"),
  service: mapColor("#858f88"),
  path: mapColor("#72a17b"),
  transit: mapColor("#62c7d9"),
  medical: mapColor("#ef7b79"),
  civic: mapColor("#b693d6"),
  food: mapColor("#e6a15c"),
  recreation: mapColor("#79bd79"),
} satisfies Record<string, Rgba>;

const DATA_LAYERS = new Set<ShortbreadLayerName>([
  "water",
  "water_lines",
  "land",
  "sites",
  "buildings",
  "streets",
  "aerialways",
  "public_transport",
  "bridges",
  "dams",
  "piers",
  "ferries",
  "boundary_lines",
  "pois",
]);

const POLYGON_STYLE_KEYS = new Set([
  "aeroway",
  "amenity",
  "landuse",
  "leisure",
  "man_made",
  "natural",
  "railway",
  "shop",
  "tourism",
  "waterway",
]);

const POINT_STYLE_KEYS = new Set([
  "aeroway",
  "amenity",
  "highway",
  "historic",
  "leisure",
  "man_made",
  "natural",
  "railway",
  "shop",
  "tourism",
]);

const VEGETATION_KINDS = new Set([
  "forest",
  "wood",
  "heath",
  "scrub",
  "wetland",
  "orchard",
  "vineyard",
]);
const GRASS_KINDS = new Set(["grass", "meadow", "recreation_ground", "village_green"]);
const AGRICULTURE_KINDS = new Set(["farmland", "allotments"]);
const SAND_KINDS = new Set(["sand", "beach", "bare_rock", "scree"]);
const COMMERCIAL_KINDS = new Set(["commercial", "retail"]);
const INDUSTRIAL_KINDS = new Set(["industrial", "railway", "quarry", "landfill"]);

const MEDICAL_POIS = new Set([
  "hospital",
  "clinic",
  "doctors",
  "dentist",
  "veterinary",
  "pharmacy",
]);
const TRANSIT_POIS = new Set([
  "bus_stop",
  "bus_station",
  "tram_stop",
  "subway_entrance",
  "railway_station",
  "halt",
  "ferry_terminal",
  "taxi",
]);
const FOOD_POIS = new Set([
  "restaurant",
  "cafe",
  "fast_food",
  "bar",
  "pub",
  "biergarten",
  "food_court",
  "ice_cream",
  "supermarket",
  "convenience",
  "bakery",
  "butcher",
  "greengrocer",
  "kiosk",
  "mall",
  "department_store",
]);
const RECREATION_POIS = new Set([
  "park",
  "garden",
  "playground",
  "stadium",
  "sports_centre",
  "swimming_pool",
  "golf_course",
  "pitch",
  "zoo",
  "theme_park",
  "attraction",
  "viewpoint",
]);
const CIVIC_POIS = new Set([
  "school",
  "kindergarten",
  "college",
  "university",
  "library",
  "community_centre",
  "arts_centre",
  "place_of_worship",
  "post_office",
  "fire_station",
  "police",
  "townhall",
  "embassy",
  "courthouse",
]);

interface RoadDefinition {
  color: Rgba;
  minZoom: number;
  casingMinZoom: number;
  rank: number;
  widths: [number, number, number];
  cased: boolean;
}

function roadDefinition(kind: StreetKind): RoadDefinition {
  if (
    kind === "motorway" ||
    kind === "motorway_link" ||
    kind === "trunk" ||
    kind === "trunk_link"
  ) {
    return {
      color: DARK_MAP_COLORS.motorway,
      minZoom: 7,
      casingMinZoom: 8,
      rank: 7,
      widths: [2, 4, 5],
      cased: true,
    };
  }
  if (kind === "primary" || kind === "primary_link") {
    return {
      color: DARK_MAP_COLORS.primary,
      minZoom: 8,
      casingMinZoom: 9,
      rank: 6,
      widths: [1, 3, 4],
      cased: true,
    };
  }
  if (kind === "secondary" || kind === "secondary_link") {
    return {
      color: DARK_MAP_COLORS.secondary,
      minZoom: 8,
      casingMinZoom: 10,
      rank: 5,
      widths: [1, 2, 3],
      cased: true,
    };
  }
  if (kind === "tertiary" || kind === "tertiary_link") {
    return {
      color: DARK_MAP_COLORS.tertiary,
      minZoom: 9,
      casingMinZoom: 11,
      rank: 4,
      widths: [1, 2, 3],
      cased: true,
    };
  }
  if (kind === "residential" || kind === "unclassified") {
    return {
      color: DARK_MAP_COLORS.residential,
      minZoom: 9,
      casingMinZoom: 12,
      rank: 3,
      widths: [1, 1, 2],
      cased: true,
    };
  }
  if (kind === "service" || kind === "living_street" || kind === "pedestrian") {
    return {
      color: DARK_MAP_COLORS.service,
      minZoom: 10,
      casingMinZoom: 13,
      rank: 2,
      widths: [1, 1, 2],
      cased: true,
    };
  }
  return {
    color: DARK_MAP_COLORS.path,
    minZoom: 14,
    casingMinZoom: Number.POSITIVE_INFINITY,
    rank: 1,
    widths: [1, 1, 2],
    cased: false,
  };
}

function hasAnyTag(tags: OsmTags, keys: ReadonlySet<string>): boolean {
  for (const key of keys) {
    if (key in tags) return true;
  }
  return false;
}

/** Cheap conservative zoom threshold used by worker-owned semantic bitsets. */
export function potentialFeatureMinZoom(
  tags: OsmTags,
  geometryType: ShortbreadGeometryType,
): number | null {
  if (geometryType === "Point") return hasAnyTag(tags, POINT_STYLE_KEYS) ? 14 : null;
  if (geometryType === "Polygon") {
    let minZoom = "building" in tags ? 13 : Number.POSITIVE_INFINITY;
    if (hasAnyTag(tags, POLYGON_STYLE_KEYS)) minZoom = 0;
    return Number.isFinite(minZoom) ? minZoom : null;
  }

  let minZoom = Number.POSITIVE_INFINITY;
  if ("waterway" in tags || "man_made" in tags) minZoom = 0;
  if ("boundary" in tags) minZoom = Math.min(minZoom, 4);
  const highway = tags["highway"];
  if (highway) minZoom = Math.min(minZoom, roadDefinition(highway as StreetKind).minZoom);
  if ("railway" in tags || "route" in tags) minZoom = Math.min(minZoom, 9);
  if ("aerialway" in tags) minZoom = Math.min(minZoom, 12);
  return Number.isFinite(minZoom) ? minZoom : null;
}

function mayHaveFeatureStyle(
  tags: OsmTags,
  geometryType: ShortbreadGeometryType,
  zoom: number,
): boolean {
  const minZoom = potentialFeatureMinZoom(tags, geometryType);
  return minZoom !== null && zoom >= minZoom;
}

function widthAtZoom(widths: RoadDefinition["widths"], zoom: number): number {
  if (zoom >= 16) return widths[2];
  if (zoom >= 14) return widths[1];
  return widths[0];
}

function muted(colorValue: Rgba): Rgba {
  return [
    Math.round((colorValue[0]! + DARK_MAP_COLORS.background[0]!) / 2),
    Math.round((colorValue[1]! + DARK_MAP_COLORS.background[1]!) / 2),
    Math.round((colorValue[2]! + DARK_MAP_COLORS.background[2]!) / 2),
    255,
  ];
}

function landColor(kind: string): Rgba {
  if (VEGETATION_KINDS.has(kind)) return DARK_MAP_COLORS.vegetation;
  if (GRASS_KINDS.has(kind)) return DARK_MAP_COLORS.grass;
  if (AGRICULTURE_KINDS.has(kind)) return DARK_MAP_COLORS.agriculture;
  if (SAND_KINDS.has(kind)) return DARK_MAP_COLORS.sand;
  if (COMMERCIAL_KINDS.has(kind)) return DARK_MAP_COLORS.commercial;
  if (INDUSTRIAL_KINDS.has(kind)) return DARK_MAP_COLORS.industrial;
  return DARK_MAP_COLORS.urban;
}

function siteColor(kind: string): Rgba {
  if (["park", "garden", "playground", "golf_course", "pitch"].includes(kind)) {
    return DARK_MAP_COLORS.grass;
  }
  if (["hospital", "prison"].includes(kind)) return mapColor("#3d292d");
  if (["university", "school", "college", "kindergarten"].includes(kind)) {
    return mapColor("#30303d");
  }
  return DARK_MAP_COLORS.site;
}

export function semanticPointCategory(kind: string): SemanticPointCategory | null {
  if (TRANSIT_POIS.has(kind)) return "transit";
  if (MEDICAL_POIS.has(kind)) return "medical";
  if (CIVIC_POIS.has(kind)) return "civic";
  if (FOOD_POIS.has(kind)) return "food";
  if (RECREATION_POIS.has(kind)) return "recreation";
  return null;
}

function pointStyle(kind: string, zoom: number): PointFeatureStyle | null {
  const size = zoom >= 16 ? 2 : 1;
  switch (semanticPointCategory(kind)) {
    case "transit":
      return { kind: "point", order: 600, color: DARK_MAP_COLORS.transit, size, symbol: "diamond" };
    case "medical":
      return { kind: "point", order: 601, color: DARK_MAP_COLORS.medical, size, symbol: "plus" };
    case "civic":
      return { kind: "point", order: 602, color: DARK_MAP_COLORS.civic, size, symbol: "square" };
    case "food":
      return { kind: "point", order: 603, color: DARK_MAP_COLORS.food, size, symbol: "dot" };
    case "recreation":
      return { kind: "point", order: 604, color: DARK_MAP_COLORS.recreation, size, symbol: "ring" };
    default:
      return null;
  }
}

function styleMatch(
  layer: ShortbreadLayerName,
  properties: ShortbreadProperties,
  geometryType: ShortbreadGeometryType,
  zoom: number,
): MapFeatureStyle | null {
  const kind = properties.kind;
  switch (layer) {
    case "land":
      return { kind: "fill", order: 10, color: landColor(kind) };
    case "sites":
      return { kind: "fill", order: 20, color: siteColor(kind) };
    case "water":
      return { kind: "fill", order: 30, color: DARK_MAP_COLORS.water };
    case "dams":
      if (properties.kind !== "dam") return null;
      return geometryType === "Polygon"
        ? { kind: "fill", order: 35, color: DARK_MAP_COLORS.waterLine }
        : { kind: "line", order: 70, color: DARK_MAP_COLORS.waterLine, width: 2 };
    case "piers":
      return geometryType === "Polygon"
        ? { kind: "fill", order: 36, color: DARK_MAP_COLORS.buildingOutline }
        : { kind: "line", order: 71, color: DARK_MAP_COLORS.buildingOutline, width: 2 };
    case "water_lines":
      return {
        kind: "line",
        order: 60,
        color: DARK_MAP_COLORS.waterLine,
        width: kind === "river" ? 2 : 1,
      };
    case "buildings":
      if (zoom < 13) return null;
      return {
        kind: "fill",
        order: 40,
        color: DARK_MAP_COLORS.building,
        outlineColor: DARK_MAP_COLORS.buildingOutline,
        outlineWidth: 1,
      };
    case "bridges":
      if (zoom < 12) return null;
      return {
        kind: "fill",
        order: 45,
        color: DARK_MAP_COLORS.site,
        outlineColor: DARK_MAP_COLORS.buildingOutline,
        outlineWidth: 1,
      };
    case "boundary_lines": {
      const adminLevel = "admin_level" in properties ? properties.admin_level : undefined;
      const minZoom = adminLevel === undefined || adminLevel <= 2 ? 4 : adminLevel <= 4 ? 8 : 12;
      if (zoom < minZoom) return null;
      return {
        kind: "line",
        order: 100,
        color: DARK_MAP_COLORS.boundary,
        width: adminLevel && adminLevel <= 2 ? 2 : 1,
      };
    }
    case "streets": {
      const definition = roadDefinition(kind as StreetKind);
      if (zoom < definition.minZoom) return null;
      const width = widthAtZoom(definition.widths, zoom);
      const isTunnel = "tunnel" in properties && properties.tunnel === true;
      const isBridge = "bridge" in properties && properties.bridge === true;
      const phase = isTunnel ? 200 : isBridge ? 400 : 300;
      const roadColor = isTunnel ? muted(definition.color) : definition.color;
      const hasCasing = definition.cased && zoom >= definition.casingMinZoom;
      return {
        kind: "line",
        order: phase + definition.rank,
        color: roadColor,
        width,
        casingColor: hasCasing ? DARK_MAP_COLORS.roadCasing : undefined,
        casingWidth: hasCasing ? width + 2 : undefined,
      };
    }
    case "public_transport":
      if (zoom < 9) return null;
      return {
        kind: "line",
        order: 500,
        color: DARK_MAP_COLORS.rail,
        width: zoom >= 16 ? 2 : 1,
        casingColor: zoom >= 11 ? DARK_MAP_COLORS.roadCasing : undefined,
        casingWidth: zoom >= 11 ? (zoom >= 16 ? 4 : 3) : undefined,
      };
    case "aerialways":
      if (zoom < 12) return null;
      return { kind: "line", order: 510, color: DARK_MAP_COLORS.civic, width: 1 };
    case "ferries":
      if (zoom < 9) return null;
      return { kind: "line", order: 520, color: DARK_MAP_COLORS.transit, width: 1 };
    case "pois":
      return zoom >= 14 ? pointStyle(kind, zoom) : null;
    default:
      return null;
  }
}

/** Classify OSM tags and resolve the built-in dark basemap styles for a zoom level. */
export function resolveFeatureStyles(
  tags: OsmTags,
  geometryType: ShortbreadGeometryType,
  zoom: number,
): MapFeatureStyle[] {
  if (!mayHaveFeatureStyle(tags, geometryType, zoom)) return [];
  const styles: MapFeatureStyle[] = [];
  for (const match of matchTags(tags, geometryType)) {
    if (!DATA_LAYERS.has(match.layer.name)) continue;
    const style = styleMatch(match.layer.name, match.properties, geometryType, zoom);
    if (style) styles.push(style);
  }
  return styles;
}
