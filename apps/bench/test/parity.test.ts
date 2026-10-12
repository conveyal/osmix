import { describe, expect, it } from "vitest";

import monacoPbf from "../../../fixtures/monaco.pbf?url";
import { runBench } from "../src/harness/runner";

// Browser mode is off in CI, and both engines need Web Workers.
describe.skipIf(import.meta.env["CI"] === "true")("Osmix and DuckDB parity", () => {
  it(
    "returns the same answer from both engines for every operation",
    { timeout: 120_000 },
    async () => {
      const blob = await (await fetch(monacoPbf)).blob();
      const report = await runBench({
        file: new File([blob], "monaco.pbf"),
        warmups: 0,
        runs: 1,
      });

      const failures = report.operations
        .filter((result) => !result.parity?.equal)
        .map((result) => `${result.operation.id}: ${result.error ?? result.parity?.diff}`);
      expect(failures).toEqual([]);
      expect(report.operations.map((result) => result.operation.id)).toEqual([
        "bbox-nodes-small",
        "bbox-nodes-medium",
        "bbox-nodes-large",
        "bbox-ways-candidates-small",
        "bbox-ways-candidates-medium",
        "bbox-ways-candidates-large",
        "bbox-ways-exact-small",
        "bbox-ways-exact-medium",
        "bbox-ways-exact-large",
        "knn",
        "tag-filter",
        "tag-aggregate",
        "geojson",
        "tile",
      ]);
      expect(report.setup.Osmix.load.counts.nodes).toBe(report.setup.DuckDB.load.counts.nodes);
      expect(report.setup.Osmix.load.counts.ways).toBe(report.setup.DuckDB.load.counts.ways);
    },
  );
});
