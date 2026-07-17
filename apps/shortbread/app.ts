import type { Progress } from "@osmix/shared/progress";
import { ShortbreadVtEncoder } from "@osmix/shortbread";
import type { Tile } from "@osmix/types";
import * as Versatiles from "@versatiles/style";
import { Hono } from "hono";
import type { StyleSpecification } from "maplibre-gl";
import type { OsmRemoteDataset, OsmixRemote } from "osmix";

import type { ShortbreadWorker } from "./shortbread.worker.ts";

export type ShortbreadServerDataset = Pick<
  OsmRemoteDataset<ShortbreadWorker>,
  "id" | "bbox" | "header" | "stats" | "isReady" | "delete"
>;
export type ShortbreadServerRemote = Pick<
  OsmixRemote<ShortbreadWorker>,
  "fromPbf" | "runWithWorker"
>;

export interface ShortbreadServerState {
  dataset: ShortbreadServerDataset;
  filename: string;
  readonly log: Progress[];
}

export function createShortbreadServerApp({
  remote,
  state,
  indexHtml,
  port,
}: {
  remote: ShortbreadServerRemote;
  state: ShortbreadServerState;
  indexHtml: string;
  port: number;
}) {
  const app = new Hono();

  app.get("/", (c) => c.html(indexHtml));
  app.get("/index.html", (c) => c.html(indexHtml));

  app.get("/remove", async (c) => {
    await state.dataset.delete();
    state.log.length = 0;
    return c.json({ status: "Removed" });
  });

  app.post("/pbf", async (c) => {
    try {
      const id = c.req.header("x-filename") ?? "new.pbf";
      const data = c.req.raw.body;
      if (!data) return c.json({ error: "No file data provided" }, 400);
      state.filename = id;
      state.dataset = await remote.fromPbf(data, { id });
      return c.json({ status: `Loading ${id}...` });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Internal server error", message: (error as Error).message }, 500);
    }
  });

  app.get("/ready", async (c) => {
    const ready = await state.dataset.isReady();
    return c.json({ ready, log: state.log });
  });

  app.get("/meta.json", async (c) => {
    const { bbox, header, stats } = state.dataset;
    const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    return c.json({
      filename: state.filename,
      bbox,
      center,
      header,
      layerNames: ShortbreadVtEncoder.layerNames,
      nodes: stats.nodes,
      ways: stats.ways,
      relations: stats.relations,
    });
  });

  app.get("/style.json", (c) => {
    const style: StyleSpecification = Versatiles.colorful({
      tiles: [`http://localhost:${port}/tiles/{z}/{x}/{y}`],
      recolor: { gamma: 2, tint: 1, tintColor: "#3b82f6" },
    });
    style.layers = style.layers.filter((layer) => layer.id !== "background");

    style.layers.forEach((layer) => {
      if (!layer.paint) return;
      if (layer.minzoom) layer.minzoom -= 2;
      if (layer.type === "line") {
        delete layer.minzoom;
        if ("line-opacity" in layer.paint && typeof layer.paint["line-opacity"] === "object") {
          layer.paint["line-opacity"] = 1;
        }
        if (
          "line-width" in layer.paint &&
          typeof layer.paint["line-width"] === "object" &&
          "stops" in layer.paint["line-width"] &&
          layer.paint["line-width"].stops[0][1] < 1
        ) {
          layer.paint["line-width"].stops[0][1] = 1;
        }
      }
      if (layer.type === "fill") {
        delete layer.minzoom;
        if (
          "fill-opacity" in layer.paint &&
          typeof layer.paint["fill-opacity"] === "object" &&
          "stops" in layer.paint["fill-opacity"] &&
          layer.paint["fill-opacity"].stops[0][1] < 1
        ) {
          layer.paint["fill-opacity"] = 1;
        }
      }
      if ("icon-opacity" in layer.paint && typeof layer.paint["icon-opacity"] === "object") {
        layer.paint["icon-opacity"] = 1;
      }
      if ("text-opacity" in layer.paint && typeof layer.paint["text-opacity"] === "object") {
        layer.paint["text-opacity"] = 1;
      }
    });
    return c.json(style);
  });

  app.get("/tiles/:z/:x/:y", async (c) => {
    const url = c.req.url;
    console.time(url);
    try {
      const { x, y, z } = c.req.param();
      const tile = await remote.runWithWorker(
        (worker) => worker.getShortbreadTile(state.dataset.id, [+x, +y, +z] as Tile),
        {
          lane: "compute",
          retry: "once",
          signal: c.req.raw.signal,
        },
      );
      return c.body(tile, 200, {
        "content-type": "application/vnd.mapbox-vector-tile",
        "access-control-allow-origin": "*",
      });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Internal server error", message: (error as Error).message }, 500);
    } finally {
      console.timeEnd(url);
    }
  });

  app.notFound((c) => c.text("Not found", 404));
  return app;
}
