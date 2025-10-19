# @osmix/shared

`@osmix/shared` exposes small geometry helpers that packages across the Osmix workspace rely on.

## Highlights

- `haversineDistance` – Compute great-circle distances between lon/lat pairs in meters.
- `clipPolyline` – Re-export of [`lineclip`](https://github.com/mourner/lineclip) for clipping projected polylines to axis-aligned bounding boxes with types added.

## Installation

```sh
npm install @osmix/shared
```

## Usage

```ts
import { haversineDistance, clipPolyline } from "@osmix/shared"

const meters = haversineDistance([-122.33, 47.61], [-122.30, 47.63])

const segments = clipPolyline(
	[
		[-122.33, 47.61],
		[-122.31, 47.62],
	],
	[-122.40, 47.50, -122.20, 47.70],
)
```
