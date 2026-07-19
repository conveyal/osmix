import {
  OsmEntityIndexBuildError,
  SpatialIndexNotBuiltError,
  TypedBufferAllocationError,
} from "@osmix/core";
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
        availableBytes: 1_000,
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
      spatialIndexes: {
        nodes: ["tagged"],
        ways: true,
        relations: true,
      },
    });
  });

  it("preserves entity allocation details and its original cause", async () => {
    installStructuredComlinkErrorTransferHandler();
    const allocationError = new TypedBufferAllocationError(
      {
        operation: "compact",
        typedArray: "Float64Array",
        bufferType: "shared-array-buffer",
        elementCount: 273_574_591,
        bytesPerElement: 8,
        requiredBytes: 2_188_596_728,
      },
      new RangeError("Array buffer allocation failed"),
    );
    const error = await roundTripError(
      new OsmEntityIndexBuildError("node", "ids", allocationError),
    );

    expect(error).toMatchObject({
      name: "OsmEntityIndexBuildError",
      code: "OSM_ENTITY_INDEX_BUILD_FAILED",
      stage: "entity-index-finalization",
      entityType: "node",
      component: "ids",
      operation: "compact",
      typedArray: "Float64Array",
      bufferType: "shared-array-buffer",
      elementCount: 273_574_591,
      bytesPerElement: 8,
      requiredBytes: 2_188_596_728,
    });
    expect((error as Error).cause).toMatchObject({
      name: "TypedBufferAllocationError",
      code: "TYPED_BUFFER_ALLOCATION_FAILED",
      operation: "compact",
    });
    expect(((error as Error).cause as Error).cause).toMatchObject({
      name: "RangeError",
      message: "Array buffer allocation failed",
    });
  });
});
