/**
 * Planner memory and time per phase, for one base and patch PBF (Task T34, tasks/004).
 *
 *   pnpm --filter @osmix/bench run plan-memory -- <base.pbf> <patch.pbf> [--apply] [--replan]
 *     [--no-matching] [--digest] [--automation=<level>] [--fresh]
 *
 * Relative paths resolve against `fixtures/`. Matching runs with the settings of the
 * Washington review: copy the default keys, connect, replace and review removals, 1 m radius,
 * drop the import's `ext:*` keys,
 * Recommended automation unless `--automation=conservative|recommended|aggressive` says otherwise.
 * Each line on stdout is one JSON measurement taken after two forced
 * garbage collections; `heapMb` is the V8 heap, `arrayBuffersMb` the typed columns, `cpuMs` the
 * process CPU time since the previous line, which other load on the machine affects less than
 * `ms`.
 * `--replan` times one replan after a decision, as review does; `--apply` builds the result;
 * `--no-matching` plans the direct, identity and crossings phases only; `--digest` prints the
 * plan's digests (`@osmix/test-utils/plan-digest`) last, to show a planner change altered nothing.
 * `--fresh` (with `--replan`) replans twice more, leaving out an automatic crossing and then an
 * automatic connection, and fails unless the result's digests equal a fresh plan's with the same
 * decisions (MP-P4): replans reuse work, and must not change what they produce.
 */
import { createReadStream } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Readable } from "node:stream";

import { planDigest } from "@osmix/test-utils/plan-digest";
import { applyPlan, fromPbf, generateMergePlanOsc, planMerge, setMergePlanDecisions } from "osmix";

const FIXTURES = resolve(import.meta.dirname, "../../../fixtures");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const automationFlag = [...flags].find((flag) => flag.startsWith("--automation="));
const automation = automationFlag?.slice("--automation=".length) ?? "recommended";
if (automation !== "conservative" && automation !== "recommended" && automation !== "aggressive") {
  throw Error(`Unknown automation level ${automation}`);
}
const [baseFile, patchFile] = args.filter((arg) => !arg.startsWith("--"));
if (!baseFile || !patchFile) {
  throw Error(
    "Usage: plan-memory <base.pbf> <patch.pbf> [--apply] [--replan] [--no-matching] [--digest] " +
      "[--automation=<level>] [--fresh]",
  );
}
const gc = globalThis.gc;
if (!gc) throw Error("Run with node --expose-gc so measurements follow a full collection");

const path = (file: string) => (isAbsolute(file) ? file : resolve(FIXTURES, file));
const stream = (file: string) =>
  Readable.toWeb(createReadStream(path(file))) as unknown as ReadableStream<Uint8Array>;
const mb = (bytes: number) => Math.round(bytes / 1e6);

let cpuBefore = process.cpuUsage();

function measure(label: string, extra: Record<string, unknown> = {}) {
  const cpu = process.cpuUsage(cpuBefore);
  gc!();
  gc!();
  const { heapUsed, arrayBuffers, rss } = process.memoryUsage();
  const row = {
    label,
    heapMb: mb(heapUsed),
    arrayBuffersMb: mb(arrayBuffers),
    rssMb: mb(rss),
    cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    ...extra,
  };
  cpuBefore = process.cpuUsage();
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
    automation,
    mergeIdenticalPoints: true,
    patchIds: "osm",
    // As Merge does: an import's own metadata stays out of base data (MP-X4).
    dropImportedKeys: ["ext:*"],
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

if (flags.has("--fresh")) {
  if (!flags.has("--replan")) throw Error("--fresh compares replans; pass --replan too");
  const automatic = (kinds: string[]) =>
    [...plan.proposals.values()].find(
      ({ kind, status, effect }) =>
        kinds.includes(kind) && status === "automatic" && effect === "applied",
    );
  // Leave out a crossing (a replan from crossings), then a connection (from matching), each
  // reusing what the passes before kept.
  for (const kinds of [["crossing-snap", "crossing-node"], ["connect"]]) {
    const proposal = automatic(kinds);
    if (!proposal) throw Error(`No automatic ${kinds.join(" or ")} proposal to leave out`);
    const decisions = [
      ...(plan.options.decisions ?? []),
      { proposalId: proposal.id, action: "reject" as const },
    ];
    started = performance.now();
    setMergePlanDecisions(plan, decisions);
    measure("replanned", { ms: Math.round(performance.now() - started), decided: proposal.id });
  }
  const fresh = planMerge(base, patch, { ...plan.options }, quiet);
  const digestOf = (planned: typeof plan) =>
    planDigest(
      planned,
      planned.diagnostics.integrity.length > 0 ? "refused" : applyPlan(planned).osm,
      generateMergePlanOsc(planned),
    );
  const replanned = digestOf(plan);
  const planned = digestOf(fresh);
  console.log(JSON.stringify({ label: "fresh", replanned, planned }));
  if (JSON.stringify(replanned) !== JSON.stringify(planned)) {
    throw Error("A replan made a different plan than a fresh plan with the same decisions");
  }
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

if (flags.has("--digest")) {
  const refused = plan.diagnostics.integrity.length > 0;
  const digest = planDigest(
    plan,
    refused ? "refused" : applyPlan(plan).osm,
    generateMergePlanOsc(plan),
  );
  console.log(JSON.stringify({ label: "digest", ...digest }));
}
