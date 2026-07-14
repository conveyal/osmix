import type { Tile } from "@osmix/types";
import { OsmixVtEncoder } from "@osmix/vt";
import { Hono } from "hono";
import type { OsmRemoteDataset } from "osmix";

export type VtServerDataset = Pick<
  OsmRemoteDataset,
  "id" | "isReady" | "get" | "getVectorTile" | "search"
>;
export interface VtServerState {
  dataset: VtServerDataset;
  readonly filename: string;
  readonly log: string[];
}

export function createVtServerApp({
  state,
  indexHtml,
}: {
  state: VtServerState;
  indexHtml: string;
}) {
  const app = new Hono();

  app.get("/", (c) => c.html(indexHtml));
  app.get("/index.html", (c) => c.html(indexHtml));

  app.get("/ready", async (c) => {
    const ready = await state.dataset.isReady();
    return c.json({ ready, log: state.log });
  });

  app.get("/meta.json", async (c) => {
    const osm = await state.dataset.get();
    const bbox = osm.bbox();
    const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    return c.json({
      filename: state.filename,
      bbox,
      center,
      header: osm.header,
      ...OsmixVtEncoder.layerNames(state.filename),
    });
  });

  app.get("/tiles/:z/:x/:y", async (c) => {
    const url = c.req.url;
    console.time(url);
    try {
      const { x, y, z } = c.req.param();
      const tile = await state.dataset.getVectorTile([+x, +y, +z] as Tile);
      return c.body(tile, 200, { "content-type": "application/vnd.mapbox-vector-tile" });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Internal server error", message: (error as Error).message }, 500);
    } finally {
      console.timeEnd(url);
    }
  });

  app.get("/search/:kv", async (c) => {
    const { kv } = c.req.param();
    const [key, val] = kv.split("=", 2);
    if (!key) return c.json({ error: "Invalid key", message: "Key is required" }, 400);
    console.log("searching for", key, val);
    return c.json(await state.dataset.search(key, val));
  });

  app.notFound((c) => c.text("Not found", 404));
  return app;
}
