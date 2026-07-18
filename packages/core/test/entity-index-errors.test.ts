import { describe, expect, it, vi } from "vitest";

import { Osm } from "../src/osm.ts";
import { TypedBufferAllocationError } from "../src/typed-arrays.ts";

describe("entity index errors", () => {
  it("adds entity and component context to typed-buffer failures", () => {
    const osm = new Osm({ id: "allocation-error" });
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
    vi.spyOn(osm.nodes.ids, "buildIndex").mockImplementation(() => {
      throw allocationError;
    });

    expect(() => osm.nodes.buildIndex()).toThrowError(
      expect.objectContaining({
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
        cause: allocationError,
      }),
    );
  });
});
