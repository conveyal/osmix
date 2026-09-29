# Osmix limits

This page lists the size limits of Osmix and the memory that a dataset uses. The first section is for users of the Osmix app. The sections after it give the details for library users.

## Summary for app users

Osmix keeps the full dataset in memory in your browser. Memory, not disk, sets the largest file that you can open.

| PBF file size    | Example                   | What to expect                                                                                            |
| ---------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Less than 100 MB | A city or a small country | Loads in seconds with all features.                                                                       |
| 100 MB to 500 MB | A large region or country | Loads with all features on most computers with 8 GB of memory or more.                                    |
| 500 MB to 1 GB   | Australia (908 MB)        | Loads in **View** mode. Merge, routing and complete extracts are off. A computer with 16 GB is necessary. |
| More than 1 GB   | Italy (2.2 GB), Planet    | Not supported in the browser. Cut a smaller extract first.                                                |

Rules of thumb:

- Memory in use after a load is about **5×** the PBF file size.
- Memory at the peak of a load is about **6×** to **7×** the PBF file size.
- Saving a dataset in browser storage uses about **4×** the PBF file size of disk quota.
- The routing graph adds between **0.3×** and **2×** the PBF file size. Road-dense areas are at the high end.
- Chrome and Edge give the best results for large files. They support `SharedArrayBuffer` and saving directly to disk.

Before a PBF loads, the app warns when the size of the file predicts View mode or a failure. The warning offers to open the file in Extract, which cuts a region out without loading the whole file.

Use **Check System** in the app to see the memory class and the largest buffer that your browser can allocate.

## Load profiles

The `@osmix/load` package and the app load a dataset with one of three profiles:

- **Full** builds every spatial index. All features work.
- **View** does not build the all-node spatial index. Map display, search and inspection work. Merge, deduplication, routing and complete or smart extracts do not work.
- **Auto** (the app default) selects Full only when all of these conditions are true. Otherwise it selects View.

Auto selects Full when:

- The all-node spatial index is 256 MiB or less. This index uses 4 bytes for each node, so the limit is 67,108,864 nodes.
- The projected typed-array peak is less than both 4 GiB and 40% of the reported device memory. Browsers report at most 8 GB of device memory, so in practice the limit is 3.2 GiB.
- Each single allocation is less than 80% of the largest buffer that Check System tested.

The values are exported as `AUTO_LOAD_PROFILE_LIMITS`. The [app README](../apps/app/README.md#loading-profiles) gives more detail.

## Measured memory use

We measured these values on 29 September 2026. Each dataset was loaded with the Full profile in Node 24, and the routing graph used the default highway filter. "Typed memory" is the total size of all typed-array buffers after the load.

| Fixture                     |       PBF |       Nodes |       Ways | Relations | Typed memory | Typed ÷ PBF | Routing graph |
| --------------------------- | --------: | ----------: | ---------: | --------: | -----------: | ----------: | ------------: |
| `spokane.osm.pbf`           |     9 MiB |   1,245,098 |    164,237 |     1,434 |       52 MiB |        5.6× |         9 MiB |
| `seattle.osm.pbf`           |    28 MiB |   2,658,358 |    533,675 |     7,513 |      143 MiB |        5.1× |        62 MiB |
| `montenegro-250101.osm.pbf` |    29 MiB |   3,915,383 |    321,330 |     5,501 |      133 MiB |        4.6× |        47 MiB |
| `australia-260716.osm.pbf`  |   909 MiB | 133,881,054 | 11,335,128 |   233,762 |    4,844 MiB |        5.3× |     1,023 MiB |
| `italy-260716.osm.pbf`      | 2,109 MiB | 273,574,591 | 30,487,361 |   596,945 |   10,539 MiB |        5.0× |     2,031 MiB |

For Australia:

- The projected typed-array peak for Full is 5,343 MiB. For View, it is 4,832 MiB. These values come from the [Australia checklist](../apps/app/AUSTRALIA-PBF-CHECKLIST.md).
- The highest resident memory of the Node process was 5,871 MiB.
- The data that the app saves in IndexedDB is 3,906 MiB.

Italy loads in Node. We did not test it in a browser, and we expect it to fail there. It has more than 268 million nodes, so its node ID column needs a 4 GiB buffer (see [Buffer limits](#buffer-limits)).

A PBF file uses about 7 to 11 bytes for each node. Use this value to estimate the node count of a file from its size.

## Memory for each entity

These values are for data after a load, with sorted IDs as in a standard PBF file.

| Entity                    | Bytes                                                                             |
| ------------------------- | --------------------------------------------------------------------------------- |
| Node                      | 16 (ID and coordinates), plus 4 in the all-node spatial index                     |
| Tagged node               | Add 4, plus 4 in the tagged-node spatial index                                    |
| Way                       | About 82 (ID, ref offsets, bounding box, spatial index), plus 4 for each node ref |
| Relation                  | About 82, plus 13 for each member                                                 |
| Tag (key and value)       | 12                                                                                |
| Way ref to a missing node | Add 12                                                                            |
| Unique string             | 6, plus its UTF-8 length                                                          |

Unsorted IDs add 12 bytes for each entity.

`Nodes.getBytesRequired`, `Ways.getBytesRequired` and `Relations.getBytesRequired` in `@osmix/core` give the same estimates. Pass the tag, ref and member counts to them to include those parts.

The peak during a load is higher than these values for three reasons:

- Each typed-array column doubles in size when it becomes full. During the copy, the old and the new buffers both exist.
- Compaction copies a `SharedArrayBuffer` column to its exact size.
- The tag index uses JavaScript arrays until it is built.

## Hard limits

These limits come from the typed-array layout in `@osmix/core`. When an entity or a dataset goes past a checked limit, Osmix throws `OsmCapacityError`.

| Limit                                      | Value                                       | When exceeded                 | Source                      |
| ------------------------------------------ | ------------------------------------------- | ----------------------------- | --------------------------- |
| Node refs in one way                       | 65,535 (`MAX_WAY_REFS`)                     | `OsmCapacityError`            | `ways.ts` (`Uint16`)        |
| Members in one relation                    | 65,535 (`MAX_RELATION_MEMBERS`)             | `OsmCapacityError`            | `relations.ts` (`Uint16`)   |
| UTF-8 bytes in one string (tag, role)      | 65,535 (`MAX_STRING_BYTES`)                 | `OsmCapacityError`            | `stringtable.ts` (`Uint16`) |
| Total way refs in a dataset                | 4,294,967,295                               | `OsmCapacityError`            | `ways.ts` (`Uint32`)        |
| Total relation members in a dataset        | 4,294,967,295                               | `OsmCapacityError`            | `relations.ts` (`Uint32`)   |
| Total string bytes in a dataset            | 4,294,967,295                               | `OsmCapacityError`            | `stringtable.ts` (`Uint32`) |
| Entities of one type                       | Less than 2^32                              | Buffer allocation fails first | `ids.ts` (`Uint32` indexes) |
| Entity IDs                                 | Exact to ±2^53. Negative IDs are permitted. | —                             | `ids.ts` (`Float64`)        |
| Coordinate precision                       | 1e-7 degrees (about 1.1 cm)                 | —                             | `nodes.ts` (`Int32`)        |
| Relation nesting depth (extract, geometry) | 10                                          | Deeper members are ignored    | `relations.ts`              |

OSM itself limits a way to 2,000 nodes and a tag value to 255 characters. Thus, the per-entity limits apply only to data from other sources, for example GeoJSON.

### Buffer limits

Each typed-array column is one buffer. A column grows by doubling: 1 MiB, 2 MiB, 4 MiB and more. Thus a column that needs slightly more than 2 GiB asks for a 4 GiB buffer.

The largest buffer that a JavaScript engine gives is different in each browser. Check System tests buffers up to 4 GiB. If the largest buffer is 2 GiB, these are the practical limits:

| Column                               | Element  | Limit at 2 GiB       |
| ------------------------------------ | -------- | -------------------- |
| Node, way or relation IDs            | 8 bytes  | 268 million entities |
| Node coordinates, way refs, tag keys | 4 bytes  | 537 million          |
| Way and relation bounding boxes      | 32 bytes | 67 million           |
| Relation member IDs                  | 8 bytes  | 268 million          |

Other engine limits:

- A JavaScript `Map` holds about 16.7 million entries in V8. The string table keeps one `Map` entry for each unique string, so a dataset can have about 16.7 million unique strings.
- The Flatbush spatial index for ways and relations stops working at about 537 million items.
- `SharedArrayBuffer` is available only on a cross-origin-isolated page. Without it, Osmix uses one worker and copies data between threads.
- To save a dataset in IndexedDB, the app copies each `SharedArrayBuffer`. For a short time, the dataset uses two times its memory.

### The full planet

The planet file has about 10 billion nodes and 1.1 billion ways. It does not fit. The node ID column alone needs 80 GB. In a browser, the first limit to fail is the size of one buffer.

## PBF format limits

`@osmix/pbf` reads and writes these parts of the PBF format:

- A blob header can be at most 64 KiB.
- A blob can be at most 32 MiB, compressed or not. The writer gives a warning at more than 16 MiB.
- The writer puts at most 8,000 entities in one block.
- Only zlib compression is supported.
- Only dense nodes are supported. A block with non-dense nodes causes an error.
- `@osmix/load` reads entities in the order nodes, then ways, then relations. A file in a different order causes `OsmPbfEntityOrderError`.

## Router limits

`@osmix/router` builds one graph for each dataset, with one highway filter and one speed table.

### What the router reads

- The `highway` tag, to select routable ways.
- The `oneway` tag and `junction=roundabout`, for direction. One-way rules also apply to pedestrian graphs.
- The `maxspeed` tag, or a default speed for each highway type, for the travel time.

### What the router does not model

- Turn restrictions (relations)
- Access tags (`access`, `motor_vehicle`, `foot`, `bicycle` and more)
- Mode-specific one-way tags (`oneway:bicycle`, `oneway:foot`)
- Conditional or time-dependent restrictions
- Turn costs
- Elevation
- A bicycle profile. `defaultPedestrianFilter` includes cycleways.
- Snapping to a point along an edge. `findNearestRoutableNode` snaps to the nearest graph node only. It needs the all-node spatial index, so it does not work in View.

### Memory and search limits

- The graph uses 16 bytes for each directed edge, plus about 4.25 bytes for each node in the dataset. This includes nodes that are not on a road.
- The build reads the routable ways two times and writes directly into typed arrays. Its peak is the final size plus 4 bytes for each node. It does not use a JavaScript `Map` or `Set`, so the 16.7 million entry limit of V8 does not apply.
- Bidirectional search builds an index of incoming edges on first use. This index uses 4 bytes for each node plus 8 bytes for each edge.
- A search has no limit on distance or time, and you cannot cancel it. If no route exists, the search examines all of the connected network before it returns `null`.
- Node, edge and way indexes are `Uint32`. Distances and times are `Float32`, with about 7 significant digits.

## Related documents

- [Merge process](./merge-process.md), with the known limits of merge.
- [`@osmix/core` README](../packages/core/README.md)
- [`@osmix/load` README](../packages/load/README.md)
- [`@osmix/router` README](../packages/router/README.md)
- [`@osmix/pbf` README](../packages/pbf/README.md)
