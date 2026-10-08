/**
 * Planner memory and time per phase, for one base and patch PBF (Task T34, tasks/004).
 *
 *   pnpm --filter @osmix/bench run plan-memory -- <base.pbf> <patch.pbf> [--apply] [--replan]
 *     [--no-matching]
 *
 * Relative paths resolve against `fixtures/`. Matching runs with the settings of the
 * Washington review: copy the default keys, connect, replace and review removals, 1 m radius,
 * Recommended automation. Each line on stdout is one JSON measurement taken after two forced
 * garbage collections; `heapMb` is the V8 heap, `arrayBuffersMb` the typed columns.
 * `--replan` times one replan after a decision, as review does; `--apply` builds the result;
 * `--no-matching` plans the direct, identity and crossings phases only.
 */
import { createReadStream } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Readable } from "node:stream";

import { applyPlan, fromPbf, planMerge, setMergePlanDecisions } from "osmix";

const FIXTURES = resolve(import.meta.dirname, "../../../fixtures");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const [baseFile, patchFile] = args.filter((arg) => !arg.startsWith("--"));
if (!baseFile || !patchFile) {
  throw Error("Usage: plan-memory <base.pbf> <patch.pbf> [--apply] [--replan] [--no-matching]");
}
const gc = globalThis.gc;
if (!gc) throw Error("Run with node --expose-gc so measurements follow a full collection");

const path = (file: string) => (isAbsolute(file) ? file : resolve(FIXTURES, file));
const stream = (file: string) =>
  Readable.toWeb(createReadStream(path(file))) as unknown as ReadableStream<Uint8Array>;
const mb = (bytes: number) => Math.round(bytes / 1e6);

function measure(label: string, extra: Record<string, unknown> = {}) {
  gc!();
  gc!();
  const { heapUsed, arrayBuffers, rss } = process.memoryUsage();
  const row = {
    label,
    heapMb: mb(heapUsed),
    arrayBuffersMb: mb(arrayBuffers),
    rssMb: mb(rss),
    ...extra,
  };
  console.log(JSON.stringify(row));
}

const quiet = () => {};
measure("start");
const base = await fromPbf(stream(baseFile), { id: "base" }, quiet);
measure("base loaded", { nodes: base.nodes.size, ways: base.ways.size });
const patch = await fromPbf(stream(patchFile), { id: "patch" }, quiet);
measure("patch loaded", { nodes: patch.nodes.size, ways: patch.ways.size });

let started = performance.now();
const plan = planMerge(
  base,
  patch,
  {
    automation: "recommended",
    mergeIdenticalPoints: true,
    patchIds: "osm",
    ...(flags.has("--no-matching")
      ? {}
      : {
          matching: {
            propertyKeys: ["barrier", "crossing", "kerb", "tactile_paving"],
            attachNetwork: true,
            allowWayRemoval: true,
            allowWayReplacement: true,
            replacementToleranceMeters: 1,
            maxDistanceMeters: 1,
            automatic: "high-confidence" as const,
          },
        }),
  },
  quiet,
  {
    phase: (name, run, stats) => {
      const phaseStarted = performance.now();
      const result = run();
      measure(`phase ${name}`, {
        ms: Math.round(performance.now() - phaseStarted),
        changes: stats().totalChanges,
      });
      return result;
    },
  },
);
measure("planned", {
  ms: Math.round(performance.now() - started),
  features: plan.features.length,
  proposals: plan.proposals.size,
  integrityIssues: plan.diagnostics.integrity.length,
});

if (flags.has("--replan")) {
  // One person's choice, as review makes it: include the first proposal waiting for one.
  const waiting = [...plan.proposals.values()].find(({ status }) => status === "review");
  if (!waiting) throw Error("No proposal waits for a decision; nothing to replan");
  started = performance.now();
  setMergePlanDecisions(plan, [{ proposalId: waiting.id, action: "accept" }]);
  measure("replanned", { ms: Math.round(performance.now() - started), decided: waiting.id });
}

if (flags.has("--apply")) {
  started = performance.now();
  const { osm } = applyPlan(plan);
  measure("applied", {
    ms: Math.round(performance.now() - started),
    nodes: osm.nodes.size,
    ways: osm.ways.size,
  });
}
