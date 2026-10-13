# @osmix/shared

Dependency-free utilities shared by Osmix packages. Worker-capable consumers can use
`runCooperatively` to split iterator work into event-loop slices, `GenerationGate` for
generation-based cancellation with a SharedArrayBuffer fast path, and `inspectBackingBuffers` to
verify backing-buffer identity and memory use.

`@osmix/shared` hosts the generic plumbing used across Osmix packages. Modules are published via subpath exports, so import the functions you need directly from `@osmix/shared/<module>`. Geometry and tile math live in [`@osmix/geo`](../geo), and OSM entity types and helpers in [`@osmix/types`](../types).

## Highlights

- Streaming helpers (`bytes-to-stream`, `stream-to-bytes`, `transform-bytes`) that normalize Node/Bun/Web APIs.
- Worker-friendly tooling (`progress`, `throttle`, `cooperative`, `generation-gate`) for consistent logging and cancellation.
- Compact data helpers (`bit-set`, `concat-bytes`, `content-hasher`) and `assert` for defensive checks.

## Installation

```sh
pnpm add @osmix/shared
```

## Modules

| Module                          | Description                                              |
| ------------------------------- | -------------------------------------------------------- |
| `@osmix/shared/assert`          | Tiny invariant helpers that throw typed errors.          |
| `@osmix/shared/backing-buffers` | Detect and inspect shared and ordinary backing buffers.  |
| `@osmix/shared/bit-set`         | Fixed-size integer set with one bit per slot.            |
| `@osmix/shared/bytes-to-stream` | Create a ReadableStream from a Uint8Array.               |
| `@osmix/shared/concat-bytes`    | Concatenate `Uint8Array` segments.                       |
| `@osmix/shared/content-hasher`  | Incremental FNV-1a hash for comparing content.           |
| `@osmix/shared/cooperative`     | Run iterator work in cancellable 8 ms event-loop slices. |
| `@osmix/shared/generation-gate` | Atomic or RPC-updated generation cancellation.           |
| `@osmix/shared/progress`        | Shared `ProgressEvent` helpers + `logProgress`.          |
| `@osmix/shared/stream-to-bytes` | Consume a ReadableStream into a Uint8Array.              |
| `@osmix/shared/throttle`        | Worker-safe throttling for logging/progress updates.     |
| `@osmix/shared/transform-bytes` | Transform streams (gzip, etc) helper.                    |

All modules are tree-shakeable; only import what you need.

## Related Packages

- [`@osmix/geo`](../geo) – Tile math, distances, bounding boxes, clipping and multipolygon helpers.
- [`@osmix/types`](../types) – OSM entity types, equality helpers, relation kinds and zigzag encoding.
- [`@osmix/core`](../core/README.md) – In-memory OSM index using these shared utilities.
- [`@osmix/load`](../load/README.md) – PBF loading that uses the streaming and progress helpers.

## Development

- `pnpm exec vitest run --project @osmix/shared`
- `pnpm exec oxlint packages/shared`

Run `pnpm run verify` at the repo root before publishing.
