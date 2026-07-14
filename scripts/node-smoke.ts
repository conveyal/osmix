import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  main?: string;
  types?: string;
  exports?: Record<string, string | { types: string; default: string }>;
}

interface WorkspacePackage {
  dir: string;
  manifest: PackageJson;
}

const repoRoot = resolve(import.meta.dirname, "..");
const packagesRoot = join(repoRoot, "packages");
const smokeDependencies = ["@osmix/core", "osmix"] as const;
const consumerSource = `import { Osm } from "@osmix/core"
import { createRemote, fromPbf } from "osmix"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const osm = new Osm({ id: "smoke" })
assert(osm.id === "smoke", "@osmix/core import failed")
assert(typeof fromPbf === "function", "fromPbf import failed")
assert(typeof createRemote === "function", "createRemote import failed")

const remote = await createRemote({ inProcess: true })
try {
  const geojson = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [7.4229, 43.7371] },
      properties: { name: "Runtime smoke" },
    }],
  }
  const data = new TextEncoder().encode(JSON.stringify(geojson))
  const dataset = await remote.fromGeoJSON(data, { id: "runtime-smoke" })
  assert(dataset.stats.nodes === 1, "GeoJSON point was not loaded")
  assert(dataset.stats.ways === 0, "GeoJSON point unexpectedly created a way")
  assert((await dataset.toPbfData()).byteLength > 0, "PBF serialization was empty")
} finally {
  remote[Symbol.dispose]()
}

console.log("Osmix runtime smoke test passed")
`;

type Runtime = "bun" | "deno" | "node";

function getRuntime(): Runtime {
  const runtime = process.argv.slice(2).find((argument) => argument !== "--") ?? "node";
  if (runtime === "bun" || runtime === "deno" || runtime === "node") return runtime;
  throw Error(`Unsupported smoke runtime: ${runtime}`);
}

function npmEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("npm_config_")) {
      delete env[key];
    }
  }
  return env;
}

function run(
  command: string,
  args: string[],
  cwd: string,
  options: { captureOutput?: boolean; cleanNpmEnv?: boolean } = {},
): string {
  const { captureOutput = false, cleanNpmEnv = false } = options;
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: cleanNpmEnv ? npmEnv() : process.env,
    stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
  });

  if (result.status !== 0) {
    throw Error(`Command failed: ${command} ${args.join(" ")}`);
  }

  return captureOutput ? result.stdout.trim() : "";
}

function getPackageJsonPath(dir: string): string {
  return join(dir, "package.json");
}

async function listWorkspacePackages(): Promise<WorkspacePackage[]> {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const workspacePackages = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dir = join(packagesRoot, entry.name);
        const manifest = JSON.parse(await readFile(getPackageJsonPath(dir), "utf8")) as PackageJson;

        if (!manifest.name || !manifest.version || manifest.private) {
          return null;
        }

        return { dir, manifest };
      }),
  );

  return workspacePackages.filter((pkg) => pkg !== null);
}

function rewritePkgJsonForDist(pkgJson: PackageJson): PackageJson {
  if (pkgJson.name === "@osmix/shared") {
    return {
      ...pkgJson,
      exports: {
        ...pkgJson.exports,
        "./*": {
          default: "./dist/*.js",
          types: "./dist/*.d.ts",
        },
      },
    };
  }

  const rewritten: PackageJson = { ...pkgJson };

  if (pkgJson.main) {
    rewritten.main = "./dist/index.js";
    rewritten.types = "./dist/index.d.ts";
  }

  if (pkgJson.exports) {
    const exports: PackageJson["exports"] = {};
    for (const [key, value] of Object.entries(pkgJson.exports)) {
      if (typeof value !== "string" || !value.startsWith("./src/")) {
        exports[key] = value;
        continue;
      }

      const jsPath = value.replace("./src/", "./dist/").replace(/\.ts$/, ".js");
      const typesPath = jsPath.replace(/\.js$/, ".d.ts");
      exports[key] = { default: jsPath, types: typesPath };
    }
    rewritten.exports = exports;
  }

  if (!rewritten.main && !rewritten.exports) {
    throw Error(`Cannot rewrite package.json for ${pkgJson.name}`);
  }

  return rewritten;
}

function serializePackageJson(pkgJson: PackageJson): string {
  return `${JSON.stringify(pkgJson, null, "\t")}\n`;
}

async function withPublishedManifest<T>(
  { dir, manifest }: WorkspacePackage,
  callback: () => Promise<T>,
): Promise<T> {
  const packageJsonPath = getPackageJsonPath(dir);
  const originalPackageJson = await readFile(packageJsonPath, "utf8");

  await writeFile(packageJsonPath, serializePackageJson(rewritePkgJsonForDist(manifest)));

  try {
    return await callback();
  } finally {
    await writeFile(packageJsonPath, originalPackageJson);
  }
}

async function packWorkspacePackage(
  workspacePackage: WorkspacePackage,
  tarballDir: string,
): Promise<[string, string]> {
  const tarballName = await withPublishedManifest(workspacePackage, async () => {
    const packOutput = run("pnpm", ["pack"], workspacePackage.dir, {
      captureOutput: true,
    });
    const packedTarball = packOutput.split("\n").at(-1)?.trim();

    if (!packedTarball) {
      throw Error(
        `No tarball generated for ${workspacePackage.manifest.name}@${workspacePackage.manifest.version}`,
      );
    }

    return packedTarball;
  });

  const tarballPath = join(tarballDir, tarballName);
  await rename(join(workspacePackage.dir, tarballName), tarballPath);

  return [workspacePackage.manifest.name, `file:${tarballPath}`];
}

function pickOverrides(
  overrides: Record<string, string>,
  names: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    names.map((name) => {
      const override = overrides[name];

      if (!override) {
        throw Error(`Missing override for ${name}`);
      }

      return [name, override];
    }),
  );
}

async function writeConsumerApp(
  consumerDir: string,
  overrides: Record<string, string>,
): Promise<void> {
  await mkdir(consumerDir, { recursive: true });

  await writeFile(join(consumerDir, "index.mjs"), consumerSource);
  await writeFile(
    join(consumerDir, "package.json"),
    JSON.stringify(
      {
        name: "osmix-node-smoke-consumer",
        private: true,
        type: "module",
        packageManager: "npm@11.6.2",
        dependencies: pickOverrides(overrides, smokeDependencies),
        overrides,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const runtime = getRuntime();
  const workspacePackages = await listWorkspacePackages();
  const tempRoot = await mkdtemp(join(tmpdir(), "osmix-node-smoke-"));

  try {
    console.log("Building workspace packages for npm smoke test...");
    run("pnpm", ["--filter", "./packages/**", "build"], repoRoot);

    const tarballDir = join(tempRoot, "tarballs");
    await mkdir(tarballDir, { recursive: true });

    const overrides: Record<string, string> = {};
    for (const workspacePackage of workspacePackages) {
      const [name, override] = await packWorkspacePackage(workspacePackage, tarballDir);
      overrides[name] = override;
    }

    const consumerDir = join(tempRoot, "consumer");
    await writeConsumerApp(consumerDir, overrides);

    console.log("Installing local tarballs into npm consumer app...");
    run("npm", ["install", "--no-fund", "--no-audit"], consumerDir, {
      cleanNpmEnv: true,
    });

    console.log(`Running ${runtime} import and data smoke test...`);
    if (runtime === "deno") {
      run("deno", ["run", "--allow-env", "--allow-read", "./index.mjs"], consumerDir);
    } else {
      const executable =
        runtime === "node" ? (process.env["OSMIX_NODE_BINARY"] ?? runtime) : runtime;
      run(executable, ["./index.mjs"], consumerDir);
    }
    if (runtime === "node") console.log("Node/npm smoke test passed");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

void main();
