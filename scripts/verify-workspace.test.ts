import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  discoverWorkspaces,
  selectWorkspaceGraph,
  validateRequiredScripts,
} from "./verify-workspace.ts";

void test("workspace selector includes reverse dependents", async () => {
  const workspaces = await discoverWorkspaces();
  const selected = selectWorkspaceGraph(workspaces, "@osmix/core").map(
    (workspace) => workspace.name,
  );

  assert.ok(selected.includes("@osmix/core"));
  assert.ok(selected.includes("osmix"));
  assert.ok(selected.includes("@osmix/vt"));
  assert.ok(!selected.includes("@osmix/pbf"));
});

void test("workspace selectors accept package paths and reject missing workspaces", async () => {
  const workspaces = await discoverWorkspaces();
  assert.equal(selectWorkspaceGraph(workspaces, "apps/vt-server")[0]?.name, "@osmix/vt-server");
  assert.throws(
    () => selectWorkspaceGraph(workspaces, "does-not-exist"),
    /No workspace matches selector: does-not-exist/,
  );
});

void test("workspace selectors report ambiguity and preserve spaces in paths", () => {
  const duplicate = (dir: string) => ({
    name: "duplicate",
    dir,
    scripts: { typecheck: "echo typecheck", test: "echo test" },
    dependencies: new Set<string>(),
    isBenchmark: false,
  });
  assert.throws(
    () => selectWorkspaceGraph([duplicate("/tmp/one"), duplicate("/tmp/two")], "duplicate"),
    /Selector is ambiguous: duplicate/,
  );

  const spacedPath = `${process.cwd()}/apps/space app`;
  const selected = selectWorkspaceGraph([duplicate(spacedPath)], "apps/space app");
  assert.equal(selected[0]?.name, "duplicate");
});

void test("missing verification scripts fail with package and script names", () => {
  assert.throws(
    () =>
      validateRequiredScripts([
        { name: "fixture", dir: ".", scripts: {}, dependencies: new Set() },
      ]),
    /Workspace fixture is missing required script: typecheck/,
  );
});

void test("discovery ignores empty directories but fails malformed manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "osmix-manifest-"));
  try {
    await mkdir(join(root, "packages", "valid"), { recursive: true });
    await mkdir(join(root, "apps", "extract"), { recursive: true });
    await mkdir(join(root, "apps", "malformed"), { recursive: true });
    await writeFile(
      join(root, "packages", "valid", "package.json"),
      JSON.stringify({ name: "valid", scripts: { typecheck: "true", test: "true" } }),
    );
    await writeFile(join(root, "apps", "malformed", "package.json"), "{ malformed", "utf8");
    await assert.rejects(
      () => discoverWorkspaces(root),
      new RegExp(`Unable to read workspace manifest at ${root}/apps/malformed/package\\.json`),
    );
    await rm(join(root, "apps", "malformed"), { recursive: true, force: true });
    const workspaces = await discoverWorkspaces(root);
    assert.deepEqual(
      workspaces.map((workspace) => workspace.name),
      ["valid"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
