# @osmix/shortbread

Shortbread schema vector tile encoder for Osmix. Generates vector tiles following the [Shortbread schema specification](https://shortbread-tiles.org/schema/1.0/).

## Installation

```bash
pnpm add @osmix/shortbread
```

## Usage

```typescript
import { fromPbf } from "osmix";
import { ShortbreadVtEncoder } from "@osmix/shortbread";

// Load OSM data
const osm = await fromPbf(pbfStream);

// Create encoder
const encoder = new ShortbreadVtEncoder(osm);

// Generate a tile
const tile = encoder.getTile([x, y, z]);
```

For repeated or concurrent tile generation, build the compact transferable classification index
once and share its backing buffers with workers:

```typescript
import { ShortbreadFeatureIndex, ShortbreadVtEncoder } from "@osmix/shortbread";

const featureIndex = ShortbreadFeatureIndex.build(osm);
const encoder = new ShortbreadVtEncoder(osm, { featureIndex });
```

The existing positional `new ShortbreadVtEncoder(osm, extent, buffer, featureIndex)` form remains
supported for compatibility.

`featureIndex.transferables()` can be reconstructed with
`ShortbreadFeatureIndex.fromTransferables()`. Its buffers use `SharedArrayBuffer` whenever the
runtime supports it, so workers can share one index without cloning regional data.
`featureIndex.query(bbox)` remains available, while the typed query form can prefilter records by
entity kind, geometry mask, and Shortbread layer before materialization.
Classified area relations suppress only the corresponding member-way layers they replace. Other
independently classified layers on the same way remain available, and route membership never
suppresses road geometry.

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
