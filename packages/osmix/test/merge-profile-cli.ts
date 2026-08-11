import { access, writeFile } from "node:fs/promises";
import { arch, cpus, platform, totalmem } from "node:os";

import { getFixtureFileReadStream, getFixturePath, PBFs } from "@osmix/test-utils/fixtures";

import { fromPbf, toPbfBuffer, type Osm, type OsmMergeOptions } from "../src/index.ts";
import {
  measureMergeProfileTask,
  osmEntityCounts,
  profileMerge,
  profileWorkerConflation,
  type MergeProfileOperationCounts,
  type MergeProfileRun,
  type MergeProfileStage,
} from "./merge-profile-harness.ts";
import { createMonacoRoutingPatch } from "./synthetic-routing-fixture.ts";

type MergeProfileScenario = "monaco" | "yakima" | "eastern-washington";

interface ScenarioDefinition {
  baseFixture: string;
  patchFixture: string;
  defaultRuns: number;
  options: Partial<OsmMergeOptions>;
  workerConflation?: boolean;
}

interface MergeProfileReport {
  schemaVersion: 1;
  scenario: MergeProfileScenario;
  fixtures: { base: string; patch: string };
  mergeOptions: Partial<OsmMergeOptions>;
  startedAt: string;
  runtime: {
    node: string;
    platform: string;
    architecture: string;
    cpu: string;
    logicalCpus: number;
    totalMemoryBytes: number;
    commit?: string;
  };
  runs: MergeProfileRun[];
  medianStageDurationMs: Record<string, number>;
  equivalence: {
    identicalFingerprints: boolean;
    identicalOperationCounts: boolean;
  };
}

const ALL_MERGE_STEPS = {
  directMerge: true,
  deduplicateNodes: true,
  deduplicateWays: true,
  createIntersections: true,
} as const;

const SCENARIOS: Record<MergeProfileScenario, ScenarioDefinition> = {
  monaco: {
    baseFixture: PBFs["monaco"]!.url,
    patchFixture: "generated Monaco routing patch",
    defaultRuns: 5,
    options: ALL_MERGE_STEPS,
  },
  yakima: {
    baseFixture: "yakima-full.osm.pbf",
    patchFixture: "yakima.osw.pbf",
    defaultRuns: 3,
    options: {
      ...ALL_MERGE_STEPS,
      conflation: {
        propertyKeys: ["barrier", "crossing", "kerb", "tactile_paving"],
        attachNetwork: true,
        maxDistanceMeters: 1,
        automatic: "high-confidence",
      },
    },
    workerConflation: true,
  },
  "eastern-washington": {
    baseFixture: "osmix-e_wa_osm.pbf",
    patchFixture: "east_washington_sidewalk_proviso_1.pbf",
    defaultRuns: 1,
    options: ALL_MERGE_STEPS,
  },
};

function usage(): string {
  return `Usage: pnpm --filter osmix profile:merge -- [options]

Options:
  --scenario <monaco|yakima|eastern-washington>  Fixture pair (default: monaco)
  --runs <count>                                  Repetitions (defaults: 5/3/1)
  --output <path>                                 Also write the JSON report to a file
  --help                                          Show this help

The same values can be set with OSMIX_MERGE_PROFILE_SCENARIO,
OSMIX_MERGE_PROFILE_RUNS, and OSMIX_MERGE_PROFILE_OUTPUT.`;
}

function optionValue(arguments_: string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) throw Error(`${name} requires a value`);
  return value;
}

function parseScenario(value: string | undefined): MergeProfileScenario {
  if (value === undefined) return "monaco";
  if (value === "monaco" || value === "yakima" || value === "eastern-washington") return value;
  throw Error(`Unknown merge profile scenario: ${value}`);
}

function parseRuns(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const runs = Number(value);
  if (!Number.isSafeInteger(runs) || runs < 1) throw Error(`Invalid run count: ${value}`);
  return runs;
}

async function requireFixture(name: string): Promise<void> {
  const path = getFixturePath(name);
  try {
    await access(path);
  } catch {
    throw Error(`Required local fixture is missing: ${path}`);
  }
}

async function loadInputs(
  scenario: MergeProfileScenario,
  definition: ScenarioDefinition,
): Promise<{ base: Osm; patch: Osm; stages: MergeProfileStage[] }> {
  await requireFixture(definition.baseFixture);
  const baseProfile = await measureMergeProfileTask("load-base-pbf", async () => {
    const base = await fromPbf(
      getFixtureFileReadStream(definition.baseFixture),
      {
        id: definition.baseFixture,
      },
      () => undefined,
    );
    return { value: base, operations: { ...osmEntityCounts(base) } };
  });
  const base = baseProfile.value;
  if (scenario === "monaco") {
    const patchProfile = await measureMergeProfileTask("load-patch-pbf", async () => {
      const patch = await fromPbf(
        await toPbfBuffer(createMonacoRoutingPatch(base)),
        {
          id: "monaco-profile-patch",
        },
        () => undefined,
      );
      return { value: patch, operations: { ...osmEntityCounts(patch) } };
    });
    return {
      base,
      patch: patchProfile.value,
      stages: [baseProfile.stage, patchProfile.stage],
    };
  }
  await requireFixture(definition.patchFixture);
  const patchProfile = await measureMergeProfileTask("load-patch-pbf", async () => {
    const patch = await fromPbf(
      getFixtureFileReadStream(definition.patchFixture),
      {
        id: definition.patchFixture,
      },
      () => undefined,
    );
    return { value: patch, operations: { ...osmEntityCounts(patch) } };
  });
  return { base, patch: patchProfile.value, stages: [baseProfile.stage, patchProfile.stage] };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  return Math.round(value * 1_000) / 1_000;
}

function medianStageDurations(runs: MergeProfileRun[]): Record<string, number> {
  const durations = new Map<string, number[]>();
  for (const run of runs) {
    for (const stage of run.stages) {
      const values = durations.get(stage.name) ?? [];
      values.push(stage.durationMs);
      durations.set(stage.name, values);
    }
  }
  return Object.fromEntries([...durations].map(([name, values]) => [name, median(values)]));
}

function stableOperations(run: MergeProfileRun): Record<string, MergeProfileOperationCounts> {
  return Object.fromEntries(run.stages.map((stage) => [stage.name, stage.operations]));
}

function assertEquivalentRuns(runs: MergeProfileRun[]) {
  const expectedFingerprint = JSON.stringify(runs[0]!.fingerprints);
  const expectedOperations = JSON.stringify(stableOperations(runs[0]!));
  const identicalFingerprints = runs.every(
    (run) => JSON.stringify(run.fingerprints) === expectedFingerprint,
  );
  const identicalOperationCounts = runs.every(
    (run) => JSON.stringify(stableOperations(run)) === expectedOperations,
  );
  if (!identicalFingerprints || !identicalOperationCounts) {
    throw Error(
      `Profile runs were not deterministic (fingerprints: ${identicalFingerprints}, operations: ${identicalOperationCounts})`,
    );
  }
  return { identicalFingerprints, identicalOperationCounts };
}

function silenceLibraryTimings(): () => void {
  const time = console.time;
  const timeEnd = console.timeEnd;
  console.time = () => undefined;
  console.timeEnd = () => undefined;
  return () => {
    console.time = time;
    console.timeEnd = timeEnd;
  };
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const scenario = parseScenario(
    optionValue(arguments_, "--scenario") ?? process.env["OSMIX_MERGE_PROFILE_SCENARIO"],
  );
  const definition = SCENARIOS[scenario];
  const runCount = parseRuns(
    optionValue(arguments_, "--runs") ?? process.env["OSMIX_MERGE_PROFILE_RUNS"],
    definition.defaultRuns,
  );
  const output = optionValue(arguments_, "--output") ?? process.env["OSMIX_MERGE_PROFILE_OUTPUT"];
  const startedAt = new Date().toISOString();
  const runs: MergeProfileRun[] = [];

  const restoreLibraryTimings = silenceLibraryTimings();
  try {
    for (let run = 1; run <= runCount; run++) {
      globalThis.gc?.();
      const { base, patch, stages } = await loadInputs(scenario, definition);
      const profile = definition.workerConflation
        ? await profileWorkerConflation(base, patch, definition.options, { run })
        : await profileMerge(base, patch, definition.options, { run });
      profile.stages.unshift(...stages);
      profile.wallDurationMs =
        Math.round(
          (profile.wallDurationMs + stages.reduce((sum, stage) => sum + stage.durationMs, 0)) *
            1_000,
        ) / 1_000;
      profile.processPeakRssBytes = Math.max(
        profile.processPeakRssBytes,
        ...stages.map((stage) => stage.processPeakRssBytes),
      );
      runs.push(profile);
    }
  } finally {
    restoreLibraryTimings();
  }

  const cpuList = cpus();
  const report: MergeProfileReport = {
    schemaVersion: 1,
    scenario,
    fixtures: { base: definition.baseFixture, patch: definition.patchFixture },
    mergeOptions: definition.options,
    startedAt,
    runtime: {
      node: process.version,
      platform: platform(),
      architecture: arch(),
      cpu: cpuList[0]?.model ?? "unknown",
      logicalCpus: cpuList.length,
      totalMemoryBytes: totalmem(),
      ...(process.env["GITHUB_SHA"] ? { commit: process.env["GITHUB_SHA"] } : {}),
    },
    runs,
    medianStageDurationMs: medianStageDurations(runs),
    equivalence: assertEquivalentRuns(runs),
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(output, json);
  process.stdout.write(json);
}

await main();
