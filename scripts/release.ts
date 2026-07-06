import { spawnSync } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 *  For each package in the repo:
 *  1. Check if the current version is already published to npm, if it is, skip.
 *  2. Build the package.
 *  3. Convert the package.json to use `dist/index.js` as the main entry point.
 *  4. Pack the package.
 *  5. Publish the package to npm.
 */

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  main?: string;
  types?: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, string | { types: string; default: string }>;
}

interface WorkspacePackage {
  dir: string;
  packageJsonPath: string;
  manifest: PackageJson;
}

const packagesRoot = resolve(import.meta.dirname, "../packages");

function run(
  command: string,
  args: string[],
  cwd: string,
  options: { captureOutput?: boolean } = {},
): string {
  const { captureOutput = false } = options;
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
  });

  if (result.status !== 0) {
    throw Error(`Command failed: ${command} ${args.join(" ")}`);
  }

  return captureOutput ? result.stdout.trim() : "";
}

async function isVersionPublished(name: string, version: string): Promise<boolean> {
  try {
    const output = run("npm", ["view", `${name}@${version}`, "version", "--json"], packagesRoot, {
      captureOutput: true,
    });
    return output.trim() !== "";
  } catch {
    return false;
  }
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

  if (pkgJson.main) {
    return {
      ...pkgJson,
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
    };
  }

  throw Error(`Cannot rewrite package.json for ${pkgJson.name}`);
}

function serializePackageJson(pkgJson: PackageJson): string {
  return `${JSON.stringify(pkgJson, null, "\t")}\n`;
}

async function withPublishedManifest<T>(
  { manifest, packageJsonPath }: WorkspacePackage,
  runPublish: () => Promise<T>,
): Promise<T> {
  try {
    await writeFile(packageJsonPath, serializePackageJson(rewritePkgJsonForDist(manifest)));
    return await runPublish();
  } finally {
    await writeFile(packageJsonPath, serializePackageJson(manifest));
  }
}

async function publishPackage(workspacePackage: WorkspacePackage): Promise<void> {
  const {
    dir,
    manifest: { name, version },
  } = workspacePackage;

  console.log(`- Publishing ${name}@${version}`);
  run("pnpm", ["run", "build"], dir);

  await withPublishedManifest(workspacePackage, async () => {
    const packOutput = run("pnpm", ["pack"], dir, {
      captureOutput: true,
    });
    const tarballToPublish = packOutput.split("\n").at(-1)?.trim();
    if (!tarballToPublish) throw Error(`No tarball generated for ${name}@${version}`);

    run("npm", ["publish", `./${tarballToPublish}`, "--access=public", "--provenance=true"], dir);
    await rm(join(dir, tarballToPublish), { force: true });
  });
}

async function runRelease(): Promise<void> {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  let publishedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dir = join(packagesRoot, entry.name);
    const packageJsonPath = join(dir, "package.json");
    const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageJson;
    if (!manifest.name || !manifest.version || manifest.private) continue;
    const alreadyPublished = await isVersionPublished(manifest.name, manifest.version);
    if (alreadyPublished) {
      console.log(`- Skipping ${manifest.name}@${manifest.version}; already published`);
      continue;
    }

    await publishPackage({ dir, packageJsonPath, manifest });
    publishedCount++;
  }

  if (publishedCount === 0) {
    console.log("No new packages published.");
  } else {
    console.log(`Published ${publishedCount} package(s)`);
  }
}

void runRelease();
