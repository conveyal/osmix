# @osmix/layercake

Import OSM data from [OpenStreetMap US Layercake](https://openstreetmap.us/our-work/layercake/) GeoParquet files into Osmix.

## Installation

```bash
bun add @osmix/layercake
```

## Usage

```typescript
import { fromLayerCake } from "@osmix/layercake"

// From a local file (Node.js/Bun)
const osm = await fromLayerCake("path/to/data.parquet", { id: "layercake" })

// From a URL (browser)
const osm = await fromLayerCake("https://example.com/data.parquet", {
	id: "layercake",
})

// Query imported data
osm.buildSpatialIndexes()
const highways = osm.ways.search("highway")
```

## Layercake Format

Layercake is an OSM data distribution format created by OpenStreetMap US. It provides
OSM data as GeoParquet files with the following schema:

- `id`: OSM entity ID (bigint)
- `geometry`: WKB-encoded geometry
- `tags`: JSON object with OSM tags

This package reads these files using [hyparquet](https://github.com/hyparam/hyparquet)
and converts them to Osmix's in-memory format for spatial queries and analysis.

## API

### `fromLayerCake(source, options?, onProgress?)`

Create an Osm index from Layercake GeoParquet data.

**Parameters:**
- `source` - File path, URL, or ArrayBuffer containing parquet data
- `options` - Optional Osm configuration (id, header)
- `onProgress` - Optional callback for progress updates

**Returns:** Promise<Osm> - Populated Osm index with built indexes
