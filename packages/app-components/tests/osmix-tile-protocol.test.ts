import { OsmixAppRemote } from "@osmix/app-core";
import type { AddProtocolAction } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addOsmixPlanProtocol, removeOsmixPlanProtocol } from "../src/lib/osmix-plan-protocol.ts";
import {
  addOsmixVectorProtocol,
  removeOsmixVectorProtocol,
} from "../src/lib/osmix-vector-protocol.ts";

const protocols = vi.hoisted(() => new Map<string, AddProtocolAction>());
vi.mock("maplibre-gl", () => ({
  addProtocol: (name: string, action: AddProtocolAction) => protocols.set(name, action),
  removeProtocol: (name: string) => protocols.delete(name),
}));

afterEach(() => {
  removeOsmixVectorProtocol();
  removeOsmixPlanProtocol();
  vi.restoreAllMocks();
});

describe.each(["vector", "plan"] as const)("%s tile protocol", (kind) => {
  for (const aborted of [false, true]) {
    it(
      aborted ? "rejects tiles completed after cancellation" : "returns completed tile data",
      async () => {
        const remote = new OsmixAppRemote();
        const abort = new AbortController();
        const data = new ArrayBuffer(8);
        const complete = async () => {
          if (aborted) abort.abort();
          return data;
        };
        if (kind === "vector") {
          vi.spyOn(remote, "runWithWorker").mockImplementation(complete);
          addOsmixVectorProtocol(remote);
        } else {
          vi.spyOn(remote, "getMergePlanTile").mockImplementation(complete);
          addOsmixPlanProtocol(remote);
        }
        const action = protocols.get(`@osmix/${kind}`);
        if (!action) throw new Error("Tile protocol was not registered");
        const url =
          kind === "vector" ? "@osmix/vector://base/1/2/3.mvt" : "@osmix/plan://base/0/1/2/3.mvt";
        const result = action({ url }, abort);
        if (aborted) {
          await expect(result).rejects.toMatchObject({ name: "AbortError" });
        } else {
          await expect(result).resolves.toEqual({ data, cacheControl: "no-cache" });
        }
      },
    );
  }
});
