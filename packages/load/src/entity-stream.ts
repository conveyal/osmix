/**
 * Convert Osm indexes to entity streams for PBF serialization.
 *
 * @module
 */

import type { Osm } from "@osmix/core";
import type { OsmPbfHeaderBlock } from "@osmix/pbf";
import type { OsmEntity } from "@osmix/types";

function* getAllEntitiesSorted(osm: Osm): Generator<OsmEntity> {
  for (const node of osm.nodes.sorted()) {
    yield node;
  }
  for (const way of osm.ways.sorted()) {
    yield way;
  }
  for (const relation of osm.relations.sorted()) {
    yield relation;
  }
}

/**
 * Convert the `Osm` index to a `ReadableStream` of header and entity objects.
 * Header is emitted first, followed by all entities in sorted order.
 * Stream can be piped through transform streams for further processing.
 */
export function createReadableEntityStreamFromOsm(
  osm: Osm,
): ReadableStream<OsmPbfHeaderBlock | OsmEntity> {
  let headerEnqueued = false;
  const entityGenerator = getAllEntitiesSorted(osm);
  return new ReadableStream<OsmPbfHeaderBlock | OsmEntity>({
    pull: async (controller) => {
      if (!headerEnqueued) {
        controller.enqueue({
          ...osm.header,
          writingprogram: "@osmix/core",
          osmosis_replication_timestamp: Date.now(),
        });
        headerEnqueued = true;
      }
      const block = entityGenerator.next();
      if (block.done) {
        controller.close();
      } else {
        controller.enqueue(block.value);
      }
    },
  });
}
