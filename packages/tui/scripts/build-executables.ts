import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import packageJson from "../package.json" with { type: "json" };
import {
  executableRoot,
  executableDependencyRoot,
  executableTargets,
  hostExecutablePath,
  releaseArchiveName,
  releaseExecutableDirectory,
  targetDefines,
  type BunExecutableTarget,
  type ExecutableTarget,
} from "./executable-targets.ts";

interface BunBuildOptions {
  compile:
    | { autoloadBunfig: false; autoloadDotenv: false; outfile: string }
    | {
        autoloadBunfig: false;
        autoloadDotenv: false;
        outfile: string;
        target: BunExecutableTarget;
      };
  define: Record<string, string>;
  entrypoints: string[];
  minify: boolean;
}

interface BunBuildResult {
  logs: unknown[];
  success: boolean;
}

interface BunRuntime {
  build(options: BunBuildOptions): Promise<BunBuildResult>;
}

const entrypoints = [
  resolve(import.meta.dirname, "../src/cli.ts"),
  resolve(import.meta.dirname, "../src/tui.worker.ts"),
];

function bunRuntime(): BunRuntime {
  const bun = (globalThis as unknown as { Bun?: BunRuntime }).Bun;
  if (!bun) throw Error("Standalone executable builds must run with Bun.");
  return bun;
}

function hostDefines(): Record<string, string> {
  const define: Record<string, string> = {
    "process.env.NODE_ENV": JSON.stringify("production"),
  };
  if (process.platform !== "linux") return define;
  const report = process.report?.getReport() as {
    header?: { glibcVersionRuntime?: string };
  };
  define["process.env.OPENTUI_LIBC"] = JSON.stringify(
    report.header?.glibcVersionRuntime ? "glibc" : "musl",
  );
  return define;
}

async function compile(
  outfile: string,
  define: Record<string, string>,
  target?: BunExecutableTarget,
): Promise<void> {
  await mkdir(dirname(outfile), { recursive: true });
  const compileOptions = target
    ? { autoloadBunfig: false as const, autoloadDotenv: false as const, outfile, target }
    : { autoloadBunfig: false as const, autoloadDotenv: false as const, outfile };
  const result = await bunRuntime().build({
    compile: compileOptions,
    define,
    entrypoints,
    minify: true,
  });
  if (!result.success) {
    throw Error(`Bun executable build failed:\n${result.logs.map(String).join("\n")}`);
  }
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status === 0) return;
  throw Error(
    `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout || result.error}`,
  );
}

async function assertNativePackages(): Promise<void> {
  const missing: string[] = [];
  for (const { nativePackage } of executableTargets) {
    try {
      await stat(resolve(executableDependencyRoot, "node_modules", nativePackage));
    } catch {
      missing.push(nativePackage);
    }
  }
  if (missing.length === 0) return;

  const corePackagePath = resolve(
    import.meta.dirname,
    "../node_modules/@opentui/core/package.json",
  );
  const corePackage = JSON.parse(await readFile(corePackagePath, "utf8")) as { version: string };
  throw Error(
    `Missing OpenTUI native packages: ${missing.join(", ")}\n` +
      "Prepare them before cross-compiling:\n" +
      `bun scripts/prepare-executable-dependencies.ts # OpenTUI ${corePackage.version}`,
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function withStagedOpenTui<T>(runBuild: () => Promise<T>): Promise<T> {
  const packageRoot = resolve(import.meta.dirname, "..");
  const opentuiScope = resolve(packageRoot, "node_modules/@opentui");
  const backupScope = resolve(packageRoot, "node_modules/@opentui-osmix-executable-backup");
  const stagedScope = resolve(executableDependencyRoot, "node_modules/@opentui");

  if (await pathExists(backupScope)) {
    await rm(opentuiScope, { force: true, recursive: true });
    await rename(backupScope, opentuiScope);
  }
  await rename(opentuiScope, backupScope);
  await symlink(stagedScope, opentuiScope, "dir");
  try {
    return await runBuild();
  } finally {
    await rm(opentuiScope, { force: true, recursive: true });
    await rename(backupScope, opentuiScope);
  }
}

async function archiveTarget(target: ExecutableTarget, executablePath: string): Promise<string> {
  const archivePath = join(
    releaseExecutableDirectory,
    releaseArchiveName(packageJson.version, target),
  );
  if (target.archive === "zip") {
    run("zip", ["-q", "-j", archivePath, executablePath]);
  } else {
    run("tar", ["-czf", archivePath, "-C", dirname(executablePath), target.executableName]);
  }
  const entries = spawnSync(
    target.archive === "zip" ? "unzip" : "tar",
    target.archive === "zip" ? ["-Z1", archivePath] : ["-tzf", archivePath],
    { encoding: "utf8" },
  );
  const names = entries.stdout?.trim().split("\n").filter(Boolean) ?? [];
  if (entries.status !== 0 || names.length !== 1 || names[0] !== target.executableName) {
    throw Error(`Unexpected contents in ${archivePath}: ${names.join(", ")}`);
  }
  return archivePath;
}

async function validateExecutable(target: ExecutableTarget, executablePath: string): Promise<void> {
  const bytes = await readFile(executablePath);
  if (target.id.startsWith("macos-")) {
    const cpu = bytes.readUInt32LE(4);
    const expectedCpu = target.id.endsWith("arm64") ? 0x0100000c : 0x01000007;
    if (bytes.readUInt32LE(0) !== 0xfeedfacf || cpu !== expectedCpu) {
      throw Error(`Unexpected Mach-O architecture for ${target.id}`);
    }
    return;
  }
  if (target.id.startsWith("linux-")) {
    const machine = bytes.readUInt16LE(18);
    const expectedMachine = target.id.includes("arm64") ? 183 : 62;
    const interpreter = target.libc === "musl" ? "/lib/ld-musl-" : "ld-linux";
    if (
      !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      machine !== expectedMachine ||
      !bytes.includes(interpreter)
    ) {
      throw Error(`Unexpected ELF architecture or libc for ${target.id}`);
    }
    return;
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  const machine = bytes.readUInt16LE(peOffset + 4);
  const expectedMachine = target.id.endsWith("arm64") ? 0xaa64 : 0x8664;
  if (bytes.subarray(0, 2).toString() !== "MZ" || machine !== expectedMachine) {
    throw Error(`Unexpected PE architecture for ${target.id}`);
  }
}

async function writeChecksums(paths: string[]): Promise<void> {
  const lines: string[] = [];
  for (const path of paths) {
    const digest = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    lines.push(`${digest}  ${path.slice(path.lastIndexOf("/") + 1)}`);
  }
  await writeFile(join(releaseExecutableDirectory, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

export async function buildHostExecutable(): Promise<string> {
  await rm(join(executableRoot, "host"), { force: true, recursive: true });
  await compile(hostExecutablePath, hostDefines());
  if (process.platform !== "win32") await chmod(hostExecutablePath, 0o755);
  return hostExecutablePath;
}

export async function buildReleaseExecutables(): Promise<string[]> {
  await assertNativePackages();
  return withStagedOpenTui(async () => {
    await rm(executableRoot, { force: true, recursive: true });
    await mkdir(releaseExecutableDirectory, { recursive: true });

    const archives: string[] = [];
    for (const target of executableTargets) {
      const executablePath = join(executableRoot, "stage", target.id, target.executableName);
      process.stdout.write(`Building ${target.id}…\n`);
      await compile(executablePath, targetDefines(target), target.bunTarget);
      if (target.executableName === "osmix") await chmod(executablePath, 0o755);
      await validateExecutable(target, executablePath);
      archives.push(await archiveTarget(target, executablePath));
    }
    await writeChecksums(archives);
    return archives;
  });
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "--host") {
    process.stdout.write(`${await buildHostExecutable()}\n`);
    return;
  }
  if (mode === "--all") {
    await buildReleaseExecutables();
    process.stdout.write(`${releaseExecutableDirectory}\n`);
    return;
  }
  throw Error("Usage: bun scripts/build-executables.ts --host|--all");
}

if (import.meta.main) await main();
