# @osmix/geoparquet

Import GeoParquet files into Osmix. OpenStreetMap US publishes GeoParquet extracts with .

## Installation

```bash
bun add @osmix/geoparquet
```

## Usage

```typescript
import { fromGeoParquet } from "@osmix/geoparquet"

// From a local file buffer
const osm = await fromGeoParquet(await Bun.file('./monaco.parquet').arrayBuffer())

// Query imported data
const highways = osm.ways.search("highway")
```

## Layercake Format

[Layercake](https://openstreetmap.us/our-work/geoparquet/) is an OSM data distribution format created by OpenStreetMap US. It provides
OSM data as GeoParquet files with the following schema:

- `id`: OSM entity ID (bigint)
- `geometry`: WKB-encoded geometry
- `tags`: JSON object with OSM tags

This package reads these files using [hyparquet](https://github.com/hyparam/hyparquet)
and converts them to Osmix's in-memory format for spatial queries and analysis.

## API

### `fromGeoParquet(source, options?, onProgress?)`

Create an Osm index from GeoParquet data.

**Parameters:**
- `source` - File path, URL, or ArrayBuffer containing parquet data
- `osmOptions` - Optional Osm configuration (id, header)
- `readOptions` - Optional GeoParquet read options
- `onProgress` - Optional callback for progress updates

**Returns:** Promise<Osm> - Populated Osm index with built indexes
