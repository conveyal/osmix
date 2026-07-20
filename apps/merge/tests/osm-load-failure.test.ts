import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OsmLoadFailurePanel } from "../src/components/osm-load-failure.tsx";
import { describeOsmLoadFailure } from "../src/lib/osm-load-failure.ts";

const ITALY_REQUIRED_BYTES = 2_188_596_728;
const TESTED_BUFFER_LIMIT = 2_144_777_216;

function structuredError(fields: Record<string, unknown>): Error {
  const message = typeof fields["message"] === "string" ? fields["message"] : "load failed";
  return Object.assign(new Error(message), fields);
}

describe("OSM load failure diagnostics", () => {
  it("explains the Italy node-ID allocation failure with the tested browser ceiling", () => {
    const failure = describeOsmLoadFailure(
      structuredError({
        name: "OsmEntityIndexBuildError",
        message: "Failed to finalize node ids: Array buffer allocation failed",
        code: "OSM_ENTITY_INDEX_BUILD_FAILED",
        stage: "entity-index-finalization",
        entityType: "node",
        component: "ids",
        operation: "compact",
        typedArray: "Float64Array",
        bufferType: "shared-array-buffer",
        elementCount: 273_574_591,
        bytesPerElement: 8,
        requiredBytes: ITALY_REQUIRED_BYTES,
      }),
      {
        sourceName: "italy-260716.osm.pbf",
        capabilities: {
          activeBufferType: "shared-array-buffer",
          arrayBufferMaxBytes: TESTED_BUFFER_LIMIT,
          sharedArrayBufferMaxBytes: TESTED_BUFFER_LIMIT,
        },
      },
    );

    expect(failure.title).toBe("Could not load italy-260716.osm.pbf");
    expect(failure.summary).toContain("node ID column");
    expect(failure.summary).toContain("2.04 GiB SharedArrayBuffer");
    expect(failure.summary).toContain("273,574,591 Float64Array elements");
    expect(failure.summary).toContain("tested browser limit is 2.00 GiB");
    expect(failure.summary).toContain("41.8 MiB less than required");
    expect(failure.suggestion).toContain("Auto, View, and Full");
    expect(failure.action).toBeUndefined();
    expect(failure.technical).toMatchObject({
      requiredBytes: ITALY_REQUIRED_BYTES,
      availableBytes: TESTED_BUFFER_LIMIT,
    });
  });

  it("offers View only when the structured capacity error recommends it", () => {
    const retryable = describeOsmLoadFailure(
      structuredError({
        code: "OSM_LOAD_CAPACITY_EXCEEDED",
        requiredBytes: 1_800,
        availableBytes: 1_600,
        suggestedProfile: "view",
      }),
      { sourceName: "large.pbf", allowViewRetry: true },
    );
    const nonRetryable = describeOsmLoadFailure(
      structuredError({
        code: "OSM_LOAD_CAPACITY_EXCEEDED",
        requiredBytes: 1_800,
        availableBytes: 1_600,
        suggestedProfile: "view",
      }),
      { sourceName: "extract.pbf", allowViewRetry: false },
    );

    expect(retryable.action).toBe("reload-view");
    expect(nonRetryable.action).toBeUndefined();
  });

  it("retains spatial-index and generic error messages", () => {
    const spatial = describeOsmLoadFailure(
      structuredError({
        code: "OSM_SPATIAL_INDEX_BUILD_FAILED",
        message: "Failed to build tagged node spatial index: out of memory",
      }),
      { sourceName: "map.pbf" },
    );
    const generic = describeOsmLoadFailure("network disconnected", {
      sourceName: "https://example.com/map.pbf",
    });

    expect(spatial.summary).toContain("tagged node spatial index");
    expect(spatial.activityMessage).toContain("while building a spatial index");
    expect(generic.summary).toBe("network disconnected");
  });

  it("renders an accessible persistent panel with technical details and actions", () => {
    const failure = describeOsmLoadFailure(
      structuredError({
        code: "OSM_LOAD_CAPACITY_EXCEEDED",
        requiredBytes: 1_800,
        availableBytes: 1_600,
        suggestedProfile: "view",
      }),
      { sourceName: "large.pbf", allowViewRetry: true },
    );
    const html = renderToStaticMarkup(
      createElement(OsmLoadFailurePanel, {
        failure,
        onDismiss: vi.fn(),
        onReloadView: vi.fn(),
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("Could not load large.pbf");
    expect(html).toContain("Reload using View");
    expect(html).toContain("Dismiss");
    expect(html).toContain("Technical details");
    expect(html).toContain("Required Bytes");
  });
});
