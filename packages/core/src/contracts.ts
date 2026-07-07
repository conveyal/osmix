import type { GeoBbox2D } from "@osmix/types";

import type { Nodes } from "./nodes.ts";
import type { Relations } from "./relations.ts";
import type { Ways } from "./ways.ts";

/**
 * Read-only contract for tile encoders, exporters, and spatial queries.
 *
 * Encoders only need entity accessors and spatial indexes; they do not mutate
 * the underlying dataset. The concrete {@link Osm} class satisfies this interface.
 */
export interface OsmReader {
  readonly id: string;
  readonly nodes: Nodes;
  readonly ways: Ways;
  readonly relations: Relations;
  bbox(): GeoBbox2D;
}

/**
 * Write contract for format importers that populate an in-memory index.
 */
export interface OsmWriter extends OsmReader {
  buildIndexes(): void;
  buildSpatialIndexes(): void;
  isReady(): boolean;
}
