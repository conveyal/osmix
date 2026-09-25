/**
 * Check that both engines returned the same answer. A row only gets timings when this
 * check passes.
 */

import { VectorTile } from "@mapbox/vector-tile";
import { decodeZigzag } from "osmix";
import { PbfReader } from "pbf";

import type { QueryResult } from "../engines/types";

export interface Comparable {
  /** Short description of the answer, such as "1,234 ids". */
  summary: string;
  /** Answer items keyed for comparison, with a value that must also match. */
  items: Map<string, string>;
}

export interface Parity {
  equal: boolean;
  osmix: string;
  duckdb: string;
  /** A sample of the differences when the answers do not match. */
  diff?: string;
}

const count = (n: number) => n.toLocaleString();

export interface GeoJSONFeatureRecord {
  id: number;
  osm_type: string;
  geometry: { type: string; coordinates: unknown };
}

const FEATURE_PREFIX = '{"type":"Feature"';
const FEATURE_HEAD =
  /\{"type":"Feature","id":(-?\d+),"osm_type":"(node|way)","geometry":\{"type":"(Point|LineString)","coordinates":/y;

/**
 * Read each feature's key and coordinate count from a GeoJSON export without building the
 * object graph; a 30 MB extract exports about 240 MB of JSON. Both engines write features
 * with the same compact key order, and any other shape throws.
 */
export function scanGeoJSONFeatures(text: string): Map<string, string> {
  const items = new Map<string, string>();
  let position = text.indexOf(FEATURE_PREFIX);
  while (position !== -1) {
    FEATURE_HEAD.lastIndex = position;
    const match = FEATURE_HEAD.exec(text);
    if (!match) throw Error(`Unexpected GeoJSON feature: ${text.slice(position, position + 120)}`);
    const [, id, osmType, geometryType] = match;
    let coordinates = 1;
    if (geometryType === "LineString") {
      const end = text.indexOf("]]", FEATURE_HEAD.lastIndex);
      if (end === -1) throw Error(`Unterminated LineString in ${osmType}/${id}`);
      for (let i = text.indexOf("],[", FEATURE_HEAD.lastIndex); i !== -1 && i < end;) {
        coordinates++;
        i = text.indexOf("],[", i + 3);
      }
    }
    const key = `${osmType}/${id}`;
    if (items.has(key)) throw Error(`Duplicate GeoJSON feature ${key}`);
    items.set(key, String(coordinates));
    position = text.indexOf(FEATURE_PREFIX, FEATURE_HEAD.lastIndex);
  }
  return items;
}

function tileItems(bytes: Uint8Array) {
  const tile = new VectorTile(new PbfReader(bytes));
  const items = new Map<string, string>();
  const layers: string[] = [];
  for (const [name, layer] of Object.entries(tile.layers)) {
    layers.push(`${count(layer.length)} ${name}`);
    for (let i = 0; i < layer.length; i++) {
      // Osmix zigzag-encodes feature ids so negative ids survive; DuckDB uses a property.
      const feature = layer.feature(i);
      const id = feature.id === undefined ? feature.properties["osm_id"] : decodeZigzag(feature.id);
      items.set(`${name}/${id}`, "");
    }
  }
  return { items, summary: `${count(bytes.byteLength)} bytes; ${layers.join(", ")}` };
}

/** Turn a result into keyed items plus a short summary. */
export function toComparable(result: QueryResult): Comparable {
  switch (result.kind) {
    case "ids": {
      const items = new Map<string, string>();
      for (const id of result.ids) items.set(String(id), "");
      return { summary: `${count(result.ids.length)} ids`, items };
    }
    case "groups": {
      const items = new Map<string, string>();
      result.values.forEach((value, i) => items.set(value, String(result.counts[i])));
      const total = result.counts.reduce((sum, n) => sum + n, 0);
      return { summary: `${count(items.size)} values, ${count(total)} ways`, items };
    }
    case "geojson": {
      const items = scanGeoJSONFeatures(result.text);
      const mb = (result.text.length / 1e6).toFixed(1);
      return { summary: `${count(items.size)} features, ${mb} MB`, items };
    }
    case "tile":
      return tileItems(result.bytes);
  }
}

function sample(keys: string[]) {
  const shown = keys.slice(0, 5).join(", ");
  return keys.length > 5 ? `${shown}, …` : shown;
}

export function compareResults(osmix: QueryResult, duckdb: QueryResult): Parity {
  const a = toComparable(osmix);
  const b = toComparable(duckdb);
  const onlyOsmix: string[] = [];
  const onlyDuckdb: string[] = [];
  const differing: string[] = [];
  for (const [key, value] of a.items) {
    if (!b.items.has(key)) onlyOsmix.push(key);
    else if (b.items.get(key) !== value) differing.push(`${key} (${value} vs ${b.items.get(key)})`);
  }
  for (const key of b.items.keys()) if (!a.items.has(key)) onlyDuckdb.push(key);

  const equal = onlyOsmix.length === 0 && onlyDuckdb.length === 0 && differing.length === 0;
  if (equal) return { equal, osmix: a.summary, duckdb: b.summary };
  const parts: string[] = [];
  if (onlyOsmix.length > 0)
    parts.push(`Osmix only (${count(onlyOsmix.length)}): ${sample(onlyOsmix)}`);
  if (onlyDuckdb.length > 0)
    parts.push(`DuckDB only (${count(onlyDuckdb.length)}): ${sample(onlyDuckdb)}`);
  if (differing.length > 0)
    parts.push(`Different (${count(differing.length)}): ${sample(differing)}`);
  return { equal, osmix: a.summary, duckdb: b.summary, diff: parts.join("\n") };
}
