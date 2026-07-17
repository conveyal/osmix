# @osmix/tui

`@osmix/tui` provides the `osmix` command for exploring a local OSM PBF file in an interactive terminal map. It parses and indexes the file with the `osmix` facade, renders styled XYZ raster tiles, and displays them through an OpenTUI framebuffer.

## Installation

### Standalone executable

Each [`@osmix/tui` GitHub Release](https://github.com/conveyal/osmix/releases) includes standalone
executables for macOS, Linux, and Windows on x64 and arm64. Linux downloads are available for both
glibc and musl. These downloads include Bun and OpenTUI, so no separate runtime is required.

On macOS or Linux, download the archive for your platform and extract it:

```sh
tar -xzf osmix-vVERSION-macos-arm64.tar.gz
chmod +x osmix
./osmix monaco.pbf
```

Windows downloads are `.zip` archives containing `osmix.exe`. Release downloads are currently
unsigned, so macOS Gatekeeper or Windows SmartScreen may ask for confirmation. Verify downloads
against the release's `SHA256SUMS` file. Minimal Alpine installations may also need `libstdc++` and
`libgcc`.

### Bun package

The native OpenTUI renderer requires [Bun](https://bun.sh/).

```sh
bun add --global @osmix/tui
```

## Usage

```sh
osmix monaco.pbf
```

The viewer opens immediately and reports parsing progress in its status bar. PBF streaming, semantic indexing, label queries, and missing map tiles stay in Web Workers so the spinner and controls remain responsive throughout loading. One logical core remains available for OpenTUI and input. The shared Osmix worker runtime supplies availability scheduling, timeouts, retry-once recovery, and diagnostics; the TUI adds a control lane for labels and compute lanes for tiles. Runtimes without shared buffers use one worker without copying the dataset onto the main thread.

The main thread retains only dataset metadata and prepared pixels. Labels arrive asynchronously for the latest camera revision, and stale results are discarded after a pan, zoom, or resize. Pending tiles use a sparse diagonal shimmer drawn during OpenTUI post-processing, while cached portions remain unchanged. Tile work is dispatched independently of successful terminal frames, so output backpressure cannot stall the queue. Shared-buffer workers cancel stale tiles through the common atomic generation gate; the single-worker fallback yields between rendering chunks so an out-of-band cancellation notification can run without moving work onto the main thread. A failed worker is restarted and rehydrated once; the viewer reports a repeated failure instead of falling back to blocking local parsing or rendering.

The built-in dark basemap classifies OSM features with the Shortbread schema. Water, land use, buildings, boundaries, transportation, and selected points use distinct, high-contrast colors and a stable layer order. Road colors and widths follow their highway class, with tunnels below surface streets and bridges above them. Overview zooms show major roads from zoom 7, secondary roads from zoom 8, tertiary and residential streets from zoom 9, and service streets from zoom 10. These additional overview streets use thin uncased strokes until their normal detail zoom. Buildings appear from zoom 13, while paths and point symbols appear from zoom 14.

The control worker builds one transferable Shortbread feature index for classification and spatial
queries. Tile workers share those backing buffers, while small TUI-owned overlays add zoom
visibility and label metadata without duplicating the dataset or building separate spatial indexes.

Named places, roads, water, parks, sites, and selected points of interest appear progressively as the map zooms in. Labels use local OSM names when available, stay horizontal for terminal readability, and are laid out across the whole viewport to avoid collisions and tile-boundary duplicates. Subtle dark backplates keep text readable without changing the raster tile cache.

### Controls

| Input                  | Action                  |
| ---------------------- | ----------------------- |
| Arrows or `h j k l`    | Pan                     |
| `+` / `-`              | Zoom one level          |
| Mouse drag             | Pan                     |
| Mouse wheel            | Zoom around the pointer |
| `0`                    | Fit the dataset         |
| `q`, Escape, or Ctrl+C | Quit                    |

The terminal can be resized while the viewer is open. Horizontal panning wraps around the antimeridian; vertical panning is limited to the Web Mercator world bounds.

## Programmatic usage

```ts
import { openPbfViewer } from "@osmix/tui";

await openPbfViewer("monaco.pbf");
```

`openPbfViewer` requires an interactive terminal and resolves after the viewer closes.

## Development

From the repository root:

```sh
pnpm --filter @osmix/tui run start -- fixtures/monaco.pbf
pnpm --filter @osmix/tui run build:executable
pnpm --filter @osmix/tui run run:executable -- fixtures/monaco.pbf
pnpm --filter @osmix/tui run test:executable
pnpm run verify:workspace -- @osmix/tui
```

The executable smoke test compiles both the CLI and its worker into one host binary, checks help and
version output, and launches Monaco in a PTY before quitting cleanly. Release CI builds the complete
eight-target matrix and attaches archives plus `SHA256SUMS` to the matching `@osmix/tui` release.

To exercise the regional-file responsiveness and memory harness with a larger local PBF:

```sh
OSMIX_TUI_STRESS_PBF=/path/to/region.osm.pbf pnpm --filter @osmix/tui run stress:regional
```

The opt-in harness renders fitted and close-zoom views followed by six rapid pan revisions. Its
JSON report includes per-revision tile and label latency, cancellation counts, animation heartbeat
gaps, main-loop stalls, RSS, worker count, and the shared-buffer/restart telemetry observable through
the renderer interface. It fails when a heartbeat or main-loop stall exceeds 250 ms. Set
`OSMIX_TUI_STRESS_TIMEOUT_MS` to raise or lower the default ten-minute timeout for each stage.
