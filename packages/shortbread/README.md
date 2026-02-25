# @osmix/shortbread

Shortbread schema vector tile encoder for Osmix. Generates vector tiles following the [Shortbread schema specification](https://shortbread-tiles.org/schema/1.0/).

## Installation

```bash
bun add @osmix/shortbread
```

## Usage

```typescript
import { fromPbf } from "osmix"
import { ShortbreadVtEncoder } from "@osmix/shortbread"

// Load OSM data
const osm = await fromPbf(pbfStream)

// Create encoder
const encoder = new ShortbreadVtEncoder(osm)

// Generate a tile
const tile = encoder.getTile([z, x, y])
```

## Layers

The encoder generates the following Shortbread-compliant layers:

- `water` - Water bodies (lakes, reservoirs, etc.)
- `water_lines` - Rivers, streams, canals
- `land` - Land cover (forests, farmland, residential, etc.)
- `sites` - Site areas (parks, zoos, hospitals, etc.)
- `buildings` - Building footprints
- `streets` - Roads and paths
- `street_labels` / `street_labels_points` - Street label placement
- `pois` - Points of interest
- `places` - Place labels (cities, towns, villages)
- `boundary_lines` / `boundary_labels` - Administrative boundaries
- `addresses` - Address points
- `public_transport` - Transit features
- `aerialways` - Ski lifts, gondolas
- `ferries` - Ferry routes
- `bridges`, `dams`, `piers` - Infrastructure features

## API

WIP
