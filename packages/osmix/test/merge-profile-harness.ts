import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  discoverConflationCandidatesForTrustedMerge,
  generateConflationApplicationArtifactsFromTrustedDiscovery,
} from "@osmix/change/src/internal/conflation.ts";
import type { Osm } from "@osmix/core";
import type { OsmEntity } from "@osmix/types";

import {
  applyChangesetToOsm,
  createOsmJsonReadableStream,
  OsmBlocksToPbfBytesTransformStream,
  OsmJsonToBlocksTransformStream,
  OsmChangeset,
  OsmixWorker,
  type OsmConflationGenerationResult,
  type OsmConflationSummary,
  type OsmMergeOptions,
  type OsmChangesetStats,
} from "../src/index.ts";

export type MergeProfileOperationCounts = Record<string, number>;

export interface MergeProfileStage {
  name: string;
  durationMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  rssBytesBefore: number;
  rssBytesAfter: number;
  heapUsedBytesBefore: number;
  heapUsedBytesAfter: number;
  /** Process-lifetime RSS high-water at stage completion, not a stage-local maximum. */
  processPeakRssBytes: number;
  operations: MergeProfileOperationCounts;
}

export interface MergeProfileFingerprints {
  /** The built-in storage-level fingerprint, including typed-buffer ordering. */
  contentHash: string;
  /** A semantic fingerprint with sorted entities and object keys but ordered refs/members. */
  canonicalSha256: string;
  /** A PBF byte fingerprint after normalizing the serializer's current-time header. */
  normalizedPbfSha256: string;
  pbfBytes: number;
}

export interface MergeProfileRun {
  run: number;
  stages: MergeProfileStage[];
  inputs: {
    base: MergeProfileEntityCounts;
    patch: MergeProfileEntityCounts;
  };
  output: MergeProfileEntityCounts;
  fingerprints: MergeProfileFingerprints;
  wallDurationMs: number;
  /** Process-lifetime RSS high-water at run completion. */
  processPeakRssBytes: number;
}

export interface MergeProfileEntityCounts {
  nodes: number;
  ways: number;
  relations: number;
}

export interface ProfileMergeOptions {
  /** A stable one-based run number included in reports. */
  run?: number;
  /** Include semantic and serialized fingerprints. Enabled by default. */
  fingerprint?: boolean;
}

interface StageResult<T> {
  value: T;
  operations?: MergeProfileOperationCounts;
}

interface MemorySnapshot {
  rss: number;
  heapUsed: number;
  peakRss: number;
}

class ProfileOsmixWorker extends OsmixWorker {
  register(osm: Osm): void {
    this.set(osm.id, osm);
  }

  read(osmId: string): Osm {
    return this.get(osmId);
  }
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function memorySnapshot(): MemorySnapshot {
  const memory = process.memoryUsage();
  return {
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    // Node reports maxRSS in KiB on every supported platform.
    peakRss: process.resourceUsage().maxRSS * 1_024,
  };
}

class MergeProfileRecorder {
  readonly stages: MergeProfileStage[] = [];

  async measure<T>(name: string, task: () => StageResult<T> | Promise<StageResult<T>>): Promise<T> {
    const memoryBefore = memorySnapshot();
    const cpuBefore = process.cpuUsage();
    const started = performance.now();
    const result = await task();
    const durationMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuBefore);
    const memoryAfter = memorySnapshot();

    this.stages.push({
      name,
      durationMs: roundMilliseconds(durationMs),
      cpuUserMs: roundMilliseconds(cpu.user / 1_000),
      cpuSystemMs: roundMilliseconds(cpu.system / 1_000),
      rssBytesBefore: memoryBefore.rss,
      rssBytesAfter: memoryAfter.rss,
      heapUsedBytesBefore: memoryBefore.heapUsed,
      heapUsedBytesAfter: memoryAfter.heapUsed,
      processPeakRssBytes: Math.max(memoryBefore.peakRss, memoryAfter.peakRss),
      operations: result.operations ?? {},
    });
    return result.value;
  }
}

/** Measure setup work, such as fixture loading, with the same stage schema. */
export async function measureMergeProfileTask<T>(
  name: string,
  task: () => StageResult<T> | Promise<StageResult<T>>,
): Promise<{ value: T; stage: MergeProfileStage }> {
  const recorder = new MergeProfileRecorder();
  const value = await recorder.measure(name, task);
  return { value, stage: recorder.stages[0]! };
}

export function osmEntityCounts(osm: Osm): MergeProfileEntityCounts {
  return {
    nodes: osm.nodes.size,
    ways: osm.ways.size,
    relations: osm.relations.size,
  };
}

function changesetCounts(stats: OsmChangesetStats): MergeProfileOperationCounts {
  return {
    totalChanges: stats.totalChanges,
    nodeChanges: stats.nodeChanges,
    wayChanges: stats.wayChanges,
    relationChanges: stats.relationChanges,
    deduplicatedNodes: stats.deduplicatedNodes,
    deduplicatedNodesReplaced: stats.deduplicatedNodesReplaced,
    deduplicatedWays: stats.deduplicatedWays,
    intersectionPointsFound: stats.intersectionPointsFound,
    intersectionNodesCreated: stats.intersectionNodesCreated,
  };
}

function prefixedCounts(
  prefix: string,
  counts: MergeProfileEntityCounts | OsmConflationSummary,
): MergeProfileOperationCounts {
  return Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [
      `${prefix}${key[0]!.toUpperCase()}${key.slice(1)}`,
      value,
    ]),
  );
}

/**
 * Serialize a JSON-compatible value with stable object-key order. Array order is
 * intentionally retained because way refs and relation members are structural.
 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
}

/** Create a semantic digest independent of entity and tag insertion order. */
export function canonicalOsmSha256(osm: Osm): string {
  const hash = createHash("sha256");
  const update = (type: string, entities: Iterable<OsmEntity>) => {
    hash.update(`${type}\n`);
    for (const entity of entities) hash.update(`${stableJson(entity)}\n`);
  };
  update("nodes", osm.nodes.sorted());
  update("ways", osm.ways.sorted());
  update("relations", osm.relations.sorted());
  return hash.digest("hex");
}

async function* sortedEntities(osm: Osm): AsyncGenerator<OsmEntity> {
  for (const node of osm.nodes.osmSorted()) yield node;
  for (const way of osm.ways.osmSorted()) yield way;
  for (const relation of osm.relations.osmSorted()) yield relation;
}

async function pbfFingerprint(osm: Osm): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  // Production export records Date.now() in this header. Normalizing that one
  // volatile field makes byte comparisons useful without changing serialization.
  const stream = createOsmJsonReadableStream(
    {
      ...osm.header,
      writingprogram: "@osmix/core",
      osmosis_replication_timestamp: 1_700_000_000_000,
    },
    sortedEntities(osm),
  )
    .pipeThrough(new OsmJsonToBlocksTransformStream())
    .pipeThrough(new OsmBlocksToPbfBytesTransformStream());
  await stream.pipeTo(
    new WritableStream<Uint8Array>({
      write(chunk) {
        hash.update(chunk);
        bytes += chunk.byteLength;
      },
    }),
  );
  return { sha256: hash.digest("hex"), bytes };
}

async function collectFingerprints(
  recorder: MergeProfileRecorder,
  osm: Osm,
  enabled: boolean,
): Promise<MergeProfileFingerprints> {
  if (!enabled) {
    return {
      contentHash: osm.contentHash(),
      canonicalSha256: "not-collected",
      normalizedPbfSha256: "not-collected",
      pbfBytes: 0,
    };
  }
  const canonicalSha256 = await recorder.measure("fingerprint-canonical-entities", () => ({
    value: canonicalOsmSha256(osm),
    operations: prefixedCounts("entity", osmEntityCounts(osm)),
  }));
  const pbf = await recorder.measure("fingerprint-pbf-output", async () => {
    const result = await pbfFingerprint(osm);
    return { value: result, operations: { pbfBytes: result.bytes } };
  });
  return {
    contentHash: osm.contentHash(),
    canonicalSha256,
    normalizedPbfSha256: pbf.sha256,
    pbfBytes: pbf.bytes,
  };
}

function routingDiagnosticCounts(
  diagnostics: OsmConflationGenerationResult["routing"],
): MergeProfileOperationCounts {
  const counts: MergeProfileOperationCounts = {};
  for (const mode of ["car", "walk"] as const) {
    for (const view of ["before", "after", "delta"] as const) {
      for (const [key, value] of Object.entries(diagnostics[mode][view])) {
        counts[
          `${mode}${view[0]!.toUpperCase()}${view.slice(1)}${key[0]!.toUpperCase()}${key.slice(1)}`
        ] = value;
      }
    }
  }
  return counts;
}

/**
 * Run the merge pipeline through its public changeset operations while recording
 * each expensive boundary separately. This intentionally follows the same order
 * as `merge`: ordinary direct/exact changes, optional conflation, then intersections.
 */
export async function profileMerge(
  base: Osm,
  patch: Osm,
  options: Partial<OsmMergeOptions>,
  profileOptions: ProfileMergeOptions = {},
): Promise<MergeProfileRun> {
  const recorder = new MergeProfileRecorder();
  const wallStarted = performance.now();
  let modifiedBase = base;

  if (options.directMerge || options.deduplicateNodes || options.deduplicateWays) {
    const changeset = await recorder.measure("prepare-direct-exact-changeset", () => ({
      value: new OsmChangeset(base),
      operations: prefixedCounts("base", osmEntityCounts(base)),
    }));

    if (options.directMerge) {
      await recorder.measure("generate-direct-changes", () => {
        changeset.generateDirectChanges(patch);
        return { value: undefined, operations: changesetCounts(changeset.stats) };
      });
    }

    if (options.deduplicateNodes) {
      await recorder.measure("reconcile-exact-nodes", () => {
        changeset.deduplicateNodes(patch.nodes);
        return { value: undefined, operations: changesetCounts(changeset.stats) };
      });
    }

    if (options.deduplicateWays) {
      await recorder.measure("reconcile-exact-ways", () => {
        let waysChecked = 0;
        let waysReconciled = 0;
        for (const reconciled of changeset.deduplicateWaysGenerator(patch.ways)) {
          waysChecked++;
          waysReconciled += reconciled;
        }
        return {
          value: undefined,
          operations: {
            ...changesetCounts(changeset.stats),
            waysChecked,
            waysReconciled,
          },
        };
      });
    }

    modifiedBase = await recorder.measure("apply-direct-exact-changes", () => {
      const result = applyChangesetToOsm(changeset);
      return {
        value: result,
        operations: {
          ...changesetCounts(changeset.stats),
          ...prefixedCounts("output", osmEntityCounts(result)),
        },
      };
    });
  }

  if (options.conflation) {
    if (!options.directMerge) {
      throw Error("Fuzzy conflation requires directMerge to preserve unmatched patch entities");
    }
    const discovery = await recorder.measure("discover-conflation-candidates", () => {
      const result = discoverConflationCandidatesForTrustedMerge(base, patch, options.conflation!);
      return {
        value: result,
        operations: prefixedCounts("candidate", result.summary),
      };
    });
    const conflation = await recorder.measure("generate-conflation-changes", () => {
      const result = generateConflationApplicationArtifactsFromTrustedDiscovery(
        modifiedBase,
        patch,
        discovery,
        base,
        options.conflation?.decisions ?? [],
      );
      return { value: result, operations: changesetCounts(result.changeset.stats) };
    });
    modifiedBase = await recorder.measure("apply-conflation-changes", () => {
      // Production installs the exact result already materialized and validated
      // during generation. Keep this boundary visible without doing the work twice.
      const result = conflation.result;
      return {
        value: result,
        operations: {
          ...changesetCounts(conflation.changeset.stats),
          ...prefixedCounts("output", osmEntityCounts(result)),
        },
      };
    });
  }

  if (options.createIntersections) {
    const changeset = await recorder.measure("prepare-intersection-changeset", () => ({
      value: new OsmChangeset(modifiedBase),
      operations: prefixedCounts("base", osmEntityCounts(modifiedBase)),
    }));
    await recorder.measure("create-safe-intersections", () => {
      let waysChecked = 0;
      for (const _result of changeset.createIntersectionsForWaysGenerator(patch.ways)) {
        waysChecked++;
      }
      return {
        value: undefined,
        operations: { ...changesetCounts(changeset.stats), waysChecked },
      };
    });
    modifiedBase = await recorder.measure("apply-intersection-changes", () => {
      const result = applyChangesetToOsm(changeset);
      return {
        value: result,
        operations: {
          ...changesetCounts(changeset.stats),
          ...prefixedCounts("output", osmEntityCounts(result)),
        },
      };
    });
  }

  const fingerprints = await collectFingerprints(
    recorder,
    modifiedBase,
    profileOptions.fingerprint ?? true,
  );

  return {
    run: profileOptions.run ?? 1,
    stages: recorder.stages,
    inputs: { base: osmEntityCounts(base), patch: osmEntityCounts(patch) },
    output: osmEntityCounts(modifiedBase),
    fingerprints,
    wallDurationMs: roundMilliseconds(performance.now() - wallStarted),
    processPeakRssBytes: memorySnapshot().peakRss,
  };
}

/**
 * Profile the production worker conflation path, including routing diagnostics,
 * the automatic-attachment CAR projection, and installation of the materialized result.
 */
export async function profileWorkerConflation(
  base: Osm,
  patch: Osm,
  options: Partial<OsmMergeOptions>,
  profileOptions: ProfileMergeOptions = {},
): Promise<MergeProfileRun> {
  if (!options.conflation) throw Error("Worker conflation profiling requires conflation options");
  if (!options.directMerge) throw Error("Worker conflation profiling requires directMerge");
  const recorder = new MergeProfileRecorder();
  const wallStarted = performance.now();
  const worker = new ProfileOsmixWorker();
  await recorder.measure("register-worker-inputs", () => {
    worker.register(base);
    worker.register(patch);
    return {
      value: undefined,
      operations: {
        ...prefixedCounts("base", osmEntityCounts(base)),
        ...prefixedCounts("patch", osmEntityCounts(patch)),
      },
    };
  });

  await recorder.measure("worker-discover-conflation-candidates", () => {
    const summary = worker.discoverConflation(base.id, patch.id, options.conflation!);
    return { value: undefined, operations: prefixedCounts("candidate", summary) };
  });
  const generation = await recorder.measure("worker-generate-conflation-changeset", () => {
    const result = worker.generateConflationChangeset(base.id, {
      directMerge: true,
      deduplicateNodes: options.deduplicateNodes ?? false,
      deduplicateWays: options.deduplicateWays ?? false,
      createIntersections: false,
    });
    return {
      value: result,
      operations: {
        ...changesetCounts(result.stats),
        ...routingDiagnosticCounts(result.routing),
      },
    };
  });
  await recorder.measure("worker-apply-conflation-result", () => {
    worker.applyChangesAndReplace(base.id);
    const result = worker.read(base.id);
    return {
      value: undefined,
      operations: {
        ...changesetCounts(generation.stats),
        ...prefixedCounts("output", osmEntityCounts(result)),
      },
    };
  });

  if (options.createIntersections) {
    const stats = await recorder.measure("worker-create-safe-intersections", async () => {
      const result = await worker.generateChangeset(base.id, patch.id, {
        createIntersections: true,
      });
      return { value: result, operations: changesetCounts(result) };
    });
    await recorder.measure("worker-apply-intersection-changes", () => {
      worker.applyChangesAndReplace(base.id);
      const result = worker.read(base.id);
      return {
        value: undefined,
        operations: {
          ...changesetCounts(stats),
          ...prefixedCounts("output", osmEntityCounts(result)),
        },
      };
    });
  }

  const output = worker.read(base.id);
  const fingerprints = await collectFingerprints(
    recorder,
    output,
    profileOptions.fingerprint ?? true,
  );
  return {
    run: profileOptions.run ?? 1,
    stages: recorder.stages,
    inputs: { base: osmEntityCounts(base), patch: osmEntityCounts(patch) },
    output: osmEntityCounts(output),
    fingerprints,
    wallDurationMs: roundMilliseconds(performance.now() - wallStarted),
    processPeakRssBytes: memorySnapshot().peakRss,
  };
}
