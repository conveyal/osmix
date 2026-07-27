import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { promisify } from "node:util";

import type { Osm } from "@osmix/core";
import { getFixtureFileReadStream } from "@osmix/test-utils/fixtures";
import { describe, expect, it } from "vitest";

import { fromPbf, merge, toPbfStream } from "../src/index.ts";

const execFileAsync = promisify(execFile);
const RUN_INTEGRATION = process.env["OSMIX_EASTERN_WASHINGTON_INTEGRATION"] === "1";
const BASE_FIXTURE = "osmix-e_wa_osm.pbf";
const PATCH_FIXTURE = "east_washington_sidewalk_proviso_1.pbf";
const COLLAPSE_WITNESSES = [
  853_782, 855_126, 898_741, 1_030_054, 1_869_808, 1_870_520, 1_870_540, 1_870_637, 4_036_007,
  4_079_228, 4_471_764,
] as const;

function sizes(osm: Osm) {
  return {
    nodes: osm.nodes.size,
    relations: osm.relations.size,
    ways: osm.ways.size,
  };
}

function expectValidWayTopology(osm: Osm) {
  const danglingRefs: string[] = [];
  const degenerateHighways: number[] = [];
  for (const way of osm.ways) {
    if (way.tags?.["highway"] != null && new Set(way.refs).size < 2) {
      degenerateHighways.push(way.id);
    }
    for (const ref of way.refs) {
      if (!osm.nodes.ids.has(ref)) danglingRefs.push(`${way.id}->${ref}`);
    }
  }
  expect(degenerateHighways).toEqual([]);
  expect(danglingRefs).toEqual([]);
}

describe("Eastern Washington full merge", () => {
  it.runIf(RUN_INTEGRATION)(
    "preserves short imported footways through export and reload",
    async () => {
      let base: Osm | null = await fromPbf(
        getFixtureFileReadStream(BASE_FIXTURE),
        { id: BASE_FIXTURE },
        () => {},
      );
      let patch: Osm | null = await fromPbf(
        getFixtureFileReadStream(PATCH_FIXTURE),
        { id: PATCH_FIXTURE },
        () => {},
      );
      expect(sizes(base)).toEqual({ nodes: 2_819_575, relations: 0, ways: 244_822 });
      expect(sizes(patch)).toEqual({ nodes: 1_107_476, relations: 0, ways: 368_648 });

      const progress: string[] = [];
      const merged = await merge(
        base,
        patch,
        {
          createIntersections: true,
          deduplicateNodes: true,
          deduplicateWays: true,
          directMerge: true,
        },
        (event) => progress.push(event.detail.msg),
      );
      base = null;
      patch = null;

      expectValidWayTopology(merged);
      for (const wayId of COLLAPSE_WITNESSES) {
        expect(new Set(merged.ways.getById(wayId)?.refs).size, `way ${wayId}`).toBeGreaterThan(1);
      }
      expect(progress).toContain("Intersection creation progress: 368,648 of 368,648 ways checked");

      const temporaryDirectory = await mkdtemp(join(tmpdir(), "osmix-eastern-washington-"));
      const outputPath = join(temporaryDirectory, "merged.osm.pbf");
      try {
        await toPbfStream(merged).pipeTo(
          Writable.toWeb(createWriteStream(outputPath)) as WritableStream<Uint8Array>,
        );
        await execFileAsync("osmium", ["check-refs", outputPath]);

        const reloaded = await fromPbf(
          Readable.toWeb(createReadStream(outputPath)) as ReadableStream<Uint8Array>,
          { id: "eastern-washington-round-trip" },
          () => {},
        );
        expect(sizes(reloaded)).toEqual(sizes(merged));
        expectValidWayTopology(reloaded);
        for (const wayId of COLLAPSE_WITNESSES) {
          expect(reloaded.ways.getById(wayId)?.refs).toEqual(merged.ways.getById(wayId)?.refs);
        }
      } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    },
    20 * 60_000,
  );
});
