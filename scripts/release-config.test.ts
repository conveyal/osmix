import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { test } from "vitest";

type ExportEntry = string | { types: string; default: string };

interface PackageJson {
  name?: string;
  private?: boolean;
  main?: string;
  exports?: Record<string, ExportEntry>;
  publishConfig?: Record<string, unknown>;
  scripts?: Record<string, string>;
}

const repoRoot = resolve(import.meta.dirname, "..");

const workspaces = ["apps", "packages"].flatMap((parent) =>
  readdirSync(join(repoRoot, parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(parent, entry.name);
      const manifest = JSON.parse(
        readFileSync(join(repoRoot, dir, "package.json"), "utf8"),
      ) as PackageJson;
      return { dir, manifest };
    }),
);

const published = workspaces.filter(({ manifest }) => !manifest.private);

/** The dist path a `./src/X.ts` source path builds to, without extension. */
function distBase(path: string): string | undefined {
  return /^\.\/src\/(.+)\.ts$/.exec(path)?.[1];
}

/** Build the `publishConfig` a package publishes with, from its source entry points. */
function expectedPublishConfig({ dir, manifest }: (typeof published)[number]) {
  const expected: Record<string, unknown> = { access: "public" };
  if (manifest.main) {
    const base = distBase(manifest.main);
    assert.ok(base, `${dir}: main must point at ./src/*.ts`);
    expected["main"] = `./dist/${base}.js`;
    expected["types"] = `./dist/${base}.d.ts`;
  }
  if (manifest.exports) {
    expected["exports"] = Object.fromEntries(
      Object.entries(manifest.exports).map(([key, entry]) => {
        const base = typeof entry === "string" ? distBase(entry) : undefined;
        if (!base) return [key, entry];
        return [key, { types: `./dist/${base}.d.ts`, default: `./dist/${base}.js` }];
      }),
    );
  }
  return expected;
}

test("published packages map every source entry point to dist in publishConfig", () => {
  assert.ok(published.length > 0);
  for (const pkg of published) {
    assert.deepEqual(pkg.manifest.publishConfig, expectedPublishConfig(pkg), pkg.dir);
  }
});

test("published packages build before packing", () => {
  for (const { dir, manifest } of published) {
    assert.equal(manifest.scripts?.["prepack"], "pnpm run build", dir);
  }
});

test("versioning ignores exactly the private workspaces", () => {
  const result = spawnSync("pnpm", ["config", "get", "versioning", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const versioning = JSON.parse(result.stdout) as { ignore?: string[] };
  const privateNames = workspaces
    .filter(({ manifest }) => manifest.private)
    .map(({ dir, manifest }) => {
      assert.ok(manifest.name, `${dir}: private workspace needs a name`);
      return manifest.name;
    });
  assert.deepEqual([...(versioning.ignore ?? [])].sort(), privateNames.sort());
});
