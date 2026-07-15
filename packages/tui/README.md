# @osmix/tui

`@osmix/tui` provides the `osmix` command for exploring a local OSM PBF file in an interactive terminal map. It parses and indexes the file with the `osmix` facade, renders color XYZ raster tiles, and displays them through an OpenTUI framebuffer.

## Installation

The native OpenTUI renderer requires [Bun](https://bun.sh/).

```sh
bun add --global @osmix/tui
```

## Usage

```sh
osmix monaco.pbf
```

The viewer opens immediately and reports parsing progress in its status bar. Once loading finishes, it centers the dataset and chooses the closest integer zoom that fits the terminal.

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
pnpm run verify:workspace -- @osmix/tui
```
