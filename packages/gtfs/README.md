# @osmix/gtfs

Convert GTFS (General Transit Feed Specification) transit feeds to OSM format.

**Lazy parsing**: Files are only parsed when accessed, not upfront.

## Installation

```bash
npm install @osmix/gtfs
# or
bun add @osmix/gtfs
```

## Usage

```ts
import { fromGtfs } from "@osmix/gtfs"

// Fetch a GTFS zip file
const response = await fetch("https://example.com/gtfs.zip")
const zipData = await response.arrayBuffer()

// Convert to OSM format
const osm = await fromGtfs(zipData, { id: "transit" })

console.log(`Imported ${osm.nodes.size} stops and ${osm.ways.size} routes`)
```

### Using GtfsArchive for Custom Processing

For more control, use `GtfsArchive` directly. Files are only parsed when you access them:

```ts
import { GtfsArchive } from "@osmix/gtfs"

const archive = GtfsArchive.fromZip(zipData)

// Only stops.txt is parsed - other files remain unread
for await (const stop of archive.iterStops()) {
  console.log(stop.stop_name, stop.stop_lat, stop.stop_lon)
}

// Access routes later - now routes.txt is parsed
const routes = await archive.routes()
```

## GTFS to OSM Mapping

### Stops → Nodes

GTFS stops are converted to OSM nodes with the following tags:

| GTFS Field           | OSM Tag              |
| -------------------- | -------------------- |
| `stop_name`          | `name`               |
| `stop_id`            | `ref`                |
| `stop_code`          | `ref:gtfs:stop_code` |
| `stop_desc`          | `description`        |
| `stop_url`           | `website`            |
| `platform_code`      | `ref:platform`       |
| `wheelchair_boarding`| `wheelchair`         |
| `location_type`      | `public_transport`   |

Location types are mapped as:
- `0` (stop) → `public_transport=platform`
- `1` (station) → `public_transport=station`
- `2` (entrance) → `railway=subway_entrance`
- `4` (boarding area) → `public_transport=platform`

### Routes → Ways

GTFS routes are converted to OSM ways with the following tags:

| GTFS Field         | OSM Tag              |
| ------------------ | -------------------- |
| `route_long_name`  | `name`               |
| `route_short_name` | `ref`                |
| `route_id`         | `ref:gtfs:route_id`  |
| `route_desc`       | `description`        |
| `route_url`        | `website`            |
| `route_color`      | `color`              |
| `route_text_color` | `text_color`         |
| `route_type`       | `route`, `gtfs:route_type` |

Route types are mapped to OSM route values:
- `0` → `tram`
- `1` → `subway`
- `2` → `train`
- `3` → `bus`
- `4` → `ferry`
- `5` → `tram` (cable tram)
- `6` → `aerialway`
- `7` → `funicular`
- `11` → `trolleybus`
- `12` → `train` (monorail)

### Geometry

Route geometry is derived from:
1. **shapes.txt** (preferred) - Uses shape points to create accurate route paths
2. **stop_times.txt** (fallback) - Uses stop sequence when shapes are unavailable

Files are only parsed when needed for the conversion.

## Options

```ts
interface GtfsConversionOptions {
  /** Whether to include stops as nodes. Default: true */
  includeStops?: boolean
  /** Filter stops by location_type. Default: include all types. */
  stopTypes?: number[]
  /** Whether to include routes as ways. Default: true */
  includeRoutes?: boolean
  /** Filter routes by route_type. Default: include all types. */
  routeTypes?: number[]
  /** Whether to include shape geometry for routes. Default: true */
  includeShapes?: boolean
}
```

### Example with Options

```ts
import { fromGtfs } from "@osmix/gtfs"

// Only bus routes, with stops and stations
const osm = await fromGtfs(zipData, { id: "buses-only" }, {
  routeTypes: [3], // Only bus routes
  stopTypes: [0, 1], // Only stops and stations
})

// Routes only (no stops) - useful for just getting route shapes
const routesOnly = await fromGtfs(zipData, { id: "routes" }, {
  includeStops: false,
})

// Stops only (no routes)
const stopsOnly = await fromGtfs(zipData, { id: "stops" }, {
  includeRoutes: false,
})
```

## API

### `fromGtfs(zipData, options?, gtfsOptions?, onProgress?)`

Main function to convert a GTFS zip file to an Osm index.

### `GtfsArchive`

Lazy GTFS archive class. Files are parsed on-demand:

```ts
const archive = GtfsArchive.fromZip(zipData)

// Check what files exist
archive.listFiles()      // ['agency.txt', 'stops.txt', ...]
archive.hasFile('shapes.txt')

// Lazy accessors (parse on first call, cache result)
await archive.agencies()
await archive.stops()
await archive.routes()
await archive.trips()
await archive.stopTimes()
await archive.shapes()

// Streaming iterators (parse and yield one at a time)
for await (const stop of archive.iterStops()) { ... }
for await (const route of archive.iterRoutes()) { ... }
for await (const shape of archive.iterShapes()) { ... }
```

### `GtfsOsmBuilder`

Class for more fine-grained control over the conversion process.

## Dependencies

- [but-unzip](https://github.com/nicolo-ribaudo/but-unzip) - ZIP file parsing
- [@std/csv](https://jsr.io/@std/csv) - Streaming CSV parsing (from Deno standard library)
- [@osmix/core](../core) - OSM data structures
