# @osmix/gtfs

Convert GTFS (General Transit Feed Specification) transit feeds to OSM format.

**Lazy parsing**: Files are only parsed when accessed, not upfront.

## Installation

```bash
npm install @osmix/gtfs
# or
pnpm add @osmix/gtfs
```

## Usage

```ts check-docs
import { fromGtfs } from "osmix";

// Fetch a GTFS zip file
const response = await fetch("https://example.com/gtfs.zip");
const zipData = await response.arrayBuffer();

// Convert to OSM format
const osm = await fromGtfs(zipData, { id: "transit" });

console.log(`Imported ${osm.nodes.size} stops and ${osm.ways.size} routes`);
```

### Using GtfsArchive for Custom Processing

For more control, use `GtfsArchive` directly. Each iterator parses only the requested file and yields rows as they are read:

```ts check-docs gtfs-zip
import { GtfsArchive } from "osmix";

const archive = GtfsArchive.fromZip(zipData);

// Only stops.txt is parsed - other files remain unread
for await (const stop of archive.iter("stops.txt")) {
  console.log(stop.stop_name, stop.stop_lat, stop.stop_lon);
}

// Access routes later - now routes.txt is parsed
for await (const route of archive.iter("routes.txt")) {
  console.log(route.route_short_name);
}
```

## GTFS to OSM Mapping

### Stops → Nodes

GTFS stops are converted to OSM nodes with the following tags:

| GTFS Field            | OSM Tag              |
| --------------------- | -------------------- |
| `stop_name`           | `name`               |
| `stop_id`             | `ref`                |
| `stop_code`           | `ref:gtfs:stop_code` |
| `stop_desc`           | `description`        |
| `stop_url`            | `website`            |
| `platform_code`       | `ref:platform`       |
| `wheelchair_boarding` | `wheelchair`         |
| `location_type`       | `public_transport`   |

Location types are mapped as:

- `0` (stop) → `public_transport=platform`
- `1` (station) → `public_transport=station`
- `2` (entrance) → `railway=subway_entrance`
- `4` (boarding area) → `public_transport=platform`

### Routes → Ways

GTFS routes are converted to OSM ways with the following tags:

| GTFS Field         | OSM Tag                    |
| ------------------ | -------------------------- |
| `route_long_name`  | `name`                     |
| `route_short_name` | `ref`                      |
| `route_id`         | `ref:gtfs:route_id`        |
| `route_desc`       | `description`              |
| `route_url`        | `website`                  |
| `route_color`      | `color`                    |
| `route_text_color` | `text_color`               |
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

Schematic option shape:

```ts schematic
interface GtfsConversionOptions {
  /** Whether to include stops as nodes. Default: true */
  includeStops?: boolean;
  /** Whether to include routes as ways. Default: true */
  includeRoutes?: boolean;
}
```

### Example with Options

```ts check-docs gtfs-zip
import { fromGtfs } from "osmix";

// Routes only (no stops) - useful for just getting route shapes
const routesOnly = await fromGtfs(
  zipData,
  { id: "routes" },
  {
    includeStops: false,
  },
);

// Stops only (no routes)
const stopsOnly = await fromGtfs(
  zipData,
  { id: "stops" },
  {
    includeRoutes: false,
  },
);
console.log(routesOnly.id, stopsOnly.id);
```

## API

### `fromGtfs(zipData, options?, gtfsOptions?, onProgress?)`

Main function to convert a GTFS zip file to an Osm index.

### `GtfsArchive`

Lazy GTFS archive class. Each `iter()` call parses the requested file on demand:

```ts check-docs gtfs-zip
import { GtfsArchive } from "osmix";

const archive = GtfsArchive.fromZip(zipData);

// Check what files exist
archive.listFiles(); // ['agency.txt', 'stops.txt', ...]
archive.hasFile("shapes.txt");

// Streaming iterator with automatic type inference
for await (const stop of archive.iter("stops.txt")) {
  console.log(stop.stop_name); // TypeScript knows this is GtfsStop
}

for await (const route of archive.iter("routes.txt")) {
  console.log(route.route_type); // TypeScript knows this is GtfsRoute
}

for await (const shape of archive.iter("shapes.txt")) {
  console.log(shape.shape_pt_lat); // TypeScript knows this is GtfsShapePoint
}
```

The `iter(filename)` method automatically infers the return type based on the filename:

- `"agency.txt"` → `AsyncGenerator<GtfsAgency>`
- `"stops.txt"` → `AsyncGenerator<GtfsStop>`
- `"routes.txt"` → `AsyncGenerator<GtfsRoute>`
- `"trips.txt"` → `AsyncGenerator<GtfsTrip>`
- `"stop_times.txt"` → `AsyncGenerator<GtfsStopTime>`
- `"shapes.txt"` → `AsyncGenerator<GtfsShapePoint>`

### `GtfsOsmBuilder`

Class for more fine-grained control over the conversion process.

## Dependencies

- [but-unzip](https://github.com/nicolo-ribaudo/but-unzip) - ZIP file parsing
- [csv-parse](https://www.npmjs.com/package/csv-parse) - CSV parsing from the csv npm
  project
- [@osmix/core](../core) - OSM data structures
