import { describe, expect, it } from "vitest";

import {
  selectOsmLoadProfile,
  selectOsmSpatialIndexes,
  type OsmLoadCapabilities,
  type OsmLoadProjection,
} from "../src/load-profile.ts";

const MIB = 2 ** 20;
const GIB = 2 ** 30;

function projection(overrides: Partial<OsmLoadProjection> = {}): OsmLoadProjection {
  const base: OsmLoadProjection = {
    entityCounts: { nodes: 1, ways: 1, relations: 1, taggedNodes: 1 },
    currentTypedArrayBytes: 512 * MIB,
    allNodeSpatialIndexBytes: 128 * MIB,
    taggedNodeSpatialIndexBytes: 4 * MIB,
    waySpatialIndexBytes: 32 * MIB,
    relationSpatialIndexBytes: 4 * MIB,
    largestPlannedAllocationBytes: 128 * MIB,
    projectedTypedArrayPeakBytes: 1 * GIB,
    profilePeaks: {
      full: {
        largestPlannedAllocationBytes: 128 * MIB,
        projectedTypedArrayPeakBytes: 1 * GIB,
      },
      view: {
        largestPlannedAllocationBytes: 32 * MIB,
        projectedTypedArrayPeakBytes: 768 * MIB,
      },
    },
    plannedAllocations: {
      allNodeSpatialIndex: 128 * MIB,
      taggedNodeSpatialIndex: 4 * MIB,
      wayTree: 32 * MIB,
      wayBboxCapacity: 32 * MIB,
      wayBbox: 16 * MIB,
      relationTree: 4 * MIB,
      relationBboxCapacity: 4 * MIB,
      relationBbox: 2 * MIB,
    },
    ...overrides,
  };
  return {
    ...base,
    profilePeaks: overrides.profilePeaks ?? {
      ...base.profilePeaks,
      full: {
        largestPlannedAllocationBytes: base.largestPlannedAllocationBytes,
        projectedTypedArrayPeakBytes: base.projectedTypedArrayPeakBytes,
      },
    },
  };
}

const capabilities: OsmLoadCapabilities = {
  deviceMemoryBytes: 8 * GIB,
  arrayBufferMaxBytes: 2 * GIB,
  activeBufferType: "array-buffer",
};

describe("selectOsmLoadProfile", () => {
  it("selects Full automatically when every memory threshold passes", () => {
    const decision = selectOsmLoadProfile("auto", projection(), capabilities);

    expect(decision.resolvedProfile).toBe("full");
    expect(decision.diagnostics).toEqual([
      expect.objectContaining({ code: "within-auto-limits", level: "info" }),
    ]);
  });

  it("selects View when the all-node index exceeds 256 MiB", () => {
    const decision = selectOsmLoadProfile(
      "auto",
      projection({ allNodeSpatialIndexBytes: 256 * MIB + 1 }),
      capabilities,
    );

    expect(decision.resolvedProfile).toBe("view");
    expect(decision.diagnostics).toEqual([
      expect.objectContaining({ code: "all-node-index-limit", level: "warning" }),
    ]);
  });

  it("uses the lower of 4 GiB and 40% of reported device memory", () => {
    const lowMemory = { ...capabilities, deviceMemoryBytes: 2 * GIB };
    const decision = selectOsmLoadProfile(
      "auto",
      projection({ projectedTypedArrayPeakBytes: 900 * MIB }),
      lowMemory,
    );

    expect(decision.resolvedProfile).toBe("view");
    expect(decision.limits.projectedTypedArrayPeakBytes).toBe(0.8 * GIB);
    expect(decision.diagnostics).toEqual([
      expect.objectContaining({ code: "typed-array-peak-limit" }),
    ]);
  });

  it("keeps 20% headroom below the active buffer ceiling", () => {
    const decision = selectOsmLoadProfile(
      "auto",
      projection({ largestPlannedAllocationBytes: 1_700 * MIB }),
      capabilities,
    );

    expect(decision.resolvedProfile).toBe("view");
    expect(decision.limits.largestPlannedAllocationBytes).toBe(1.6 * GIB);
    expect(decision.diagnostics).toEqual([
      expect.objectContaining({ code: "single-allocation-limit" }),
    ]);
  });

  it.each(["full", "view"] as const)("honors an explicit %s selection", (profile) => {
    const decision = selectOsmLoadProfile(
      profile,
      projection({
        allNodeSpatialIndexBytes: 1 * GIB,
        projectedTypedArrayPeakBytes: 10 * GIB,
      }),
      capabilities,
    );

    expect(decision.resolvedProfile).toBe(profile);
    expect(decision.diagnostics[0]).toEqual(
      expect.objectContaining({ code: "explicit-profile", level: "info" }),
    );
  });

  it("warns but attempts View when only its working-set guideline is exceeded", () => {
    const input = projection({
      profilePeaks: {
        full: {
          largestPlannedAllocationBytes: 2 * GIB,
          projectedTypedArrayPeakBytes: 12 * GIB,
        },
        view: {
          largestPlannedAllocationBytes: 64 * MIB,
          projectedTypedArrayPeakBytes: 5 * GIB,
        },
      },
    });

    const decision = selectOsmLoadProfile("view", input, capabilities);

    expect(decision.resolvedProfile).toBe("view");
    expect(decision.diagnostics).toContainEqual(
      expect.objectContaining({ code: "selected-typed-array-peak-limit" }),
    );
  });

  it("hard-fails an explicit profile when one selected allocation exceeds headroom", () => {
    const input = projection({
      profilePeaks: {
        full: {
          largestPlannedAllocationBytes: 1_700 * MIB,
          projectedTypedArrayPeakBytes: 3 * GIB,
        },
        view: {
          largestPlannedAllocationBytes: 32 * MIB,
          projectedTypedArrayPeakBytes: 768 * MIB,
        },
      },
    });

    let error: unknown;
    try {
      selectOsmLoadProfile("full", input, capabilities);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "OSM_LOAD_CAPACITY_EXCEEDED",
      requiredBytes: 1_700 * MIB,
      availableBytes: 1.6 * GIB,
      suggestedProfile: "view",
    });
  });

  it("treats a measured buffer ceiling of zero as an empty allocation budget", () => {
    const zeroCeiling = { ...capabilities, arrayBufferMaxBytes: 0 };
    const selections = [
      () => selectOsmLoadProfile("view", projection(), zeroCeiling),
      () =>
        selectOsmSpatialIndexes(
          { nodes: ["tagged"], ways: true, relations: true },
          projection(),
          zeroCeiling,
        ),
    ];

    for (const select of selections) {
      let error: unknown;
      try {
        select();
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({
        code: "OSM_LOAD_CAPACITY_EXCEEDED",
        availableBytes: 0,
      });
    }
  });
});
