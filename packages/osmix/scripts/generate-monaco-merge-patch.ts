/**
 * Regenerate `fixtures/monaco-merge-patch.geojson` from the scenarios in
 * `@osmix/test-utils/monaco-merge-scenarios`, anchored to `fixtures/monaco.pbf`, then format it.
 * Run with `pnpm --filter osmix run fixtures:generate:merge-patch`.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { fromPbf } from "@osmix/load";
import { getFixtureFileReadStream, getFixturePath } from "@osmix/test-utils/fixtures";
import { MONACO_MERGE_PATCH } from "@osmix/test-utils/monaco-merge-scenarios";

import { buildMonacoMergePatch } from "../test/fixtures/monaco-merge-patch.ts";

const base = await fromPbf(getFixtureFileReadStream("monaco.pbf"), { id: "monaco" });
const path = getFixturePath(MONACO_MERGE_PATCH);
writeFileSync(path, `${JSON.stringify(buildMonacoMergePatch(base))}\n`);
execFileSync("pnpm", ["exec", "oxfmt", path], { stdio: "inherit" });
console.log(`Wrote ${path}`);
