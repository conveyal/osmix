# @osmix/shortbread

Shortbread schema vector tile encoder for Osmix. Generates vector tiles following the [Shortbread schema specification](https://shortbread-tiles.org/schema/1.0/).

## Installation

```bash
bun add @osmix/shortbread
```

## Usage

```typescript
import { Osmix } from "@osmix/osmix"
import { ShortbreadVtEncoder } from "@osmix/shortbread"

// Load OSM data
const osmix = await Osmix.fromPbf(pbfData)

// Create encoder
const encoder = new ShortbreadVtEncoder(osmix.osm)

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

### `ShortbreadVtEncoder`

```typescript
class ShortbreadVtEncoder {
  constructor(osm: Osm, extent?: number, buffer?: number)
  
  // Get all layer names
  static get layerNames(): ShortbreadLayerName[]
  
  // Generate tile for tile coordinates
  getTile(tile: Tile): ArrayBuffer
  
  // Generate tile for bounding box
  getTileForBbox(bbox: GeoBbox2D, proj: (ll: LonLat) => XY): ArrayBuffer
}
```

### Layer Matching

```typescript
import { matchTags, SHORTBREAD_LAYERS } from "@osmix/shortbread"

// Match OSM tags to a Shortbread layer
const match = matchTags({ highway: "primary" }, "LineString")
// { layer: { name: "streets", ... }, properties: { kind: "primary", ... } }
```

## License

MIT
