import { SpatialIndexNotBuiltError } from "@osmix/core";
import { OsmLoadCapacityError } from "@osmix/load";
import * as Comlink from "comlink";
import { describe, expect, it } from "vitest";

import { installStructuredComlinkErrorTransferHandler } from "../src/comlink-errors.ts";

async function roundTripError(error: Error): Promise<unknown> {
  const { port1, port2 } = new MessageChannel();
  const endpoint = {
    throwError(): void {
      throw error;
    },
  };
  Comlink.expose(endpoint, port1);
  const remote = Comlink.wrap<typeof endpoint>(port2);
  try {
    return await remote.throwError().then(
      () => new Error("Expected the remote method to throw"),
      (caught: unknown) => caught,
    );
  } finally {
    port1.close();
    port2.close();
  }
}

describe("structured Comlink errors", () => {
  it("installs the throw handler idempotently", () => {
    installStructuredComlinkErrorTransferHandler();
    const installed = Comlink.transferHandlers.get("throw");
    installStructuredComlinkErrorTransferHandler();
    expect(Comlink.transferHandlers.get("throw")).toBe(installed);
  });

  it("preserves SpatialIndexNotBuiltError fields", async () => {
    installStructuredComlinkErrorTransferHandler();
    const error = await roundTripError(new SpatialIndexNotBuiltError("all"));

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "SpatialIndexNotBuiltError",
      message: "The all node spatial index has not been built.",
      code: "SPATIAL_INDEX_NOT_BUILT",
      entityType: "node",
      indexKind: "all",
    });
  });

  it("preserves OsmLoadCapacityError fields and nested selection", async () => {
    installStructuredComlinkErrorTransferHandler();
    const error = await roundTripError(
      new OsmLoadCapacityError({
        requestedProfile: "auto",
        resolvedProfile: "view",
        requiredBytes: 2_000,
        limitBytes: 1_000,
        spatialIndexes: {
          nodes: ["tagged"],
          ways: true,
          relations: true,
        },
      }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "OsmLoadCapacityError",
      code: "OSM_LOAD_CAPACITY_EXCEEDED",
      stage: "spatial-index-preflight",
      requestedProfile: "auto",
      resolvedProfile: "view",
      requiredBytes: 2_000,
      availableBytes: 1_000,
      limitBytes: 1_000,
      spatialIndexes: {
        nodes: ["tagged"],
        ways: true,
        relations: true,
      },
    });
  });
});
