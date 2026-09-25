import { setWorkerUrl } from "maplibre-gl";
// oxlint-disable-next-line import/default -- Vite ?worker&url resolves to a string URL
import MaplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

/**
 * MapLibre GL 6 locates its worker as a sibling of its own module via `import.meta.url`. Vite
 * rewrites that URL during dependency optimization and bundling and never emits the sibling
 * file, so every map would silently render nothing. Point MapLibre at the worker Vite bundles
 * instead. This must run before the first `Map` is constructed.
 */
setWorkerUrl(new URL(MaplibreWorkerUrl, import.meta.url).href);
