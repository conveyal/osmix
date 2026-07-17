import { join } from "node:path";

export type ExecutableTargetId =
  | "macos-arm64"
  | "macos-x64"
  | "linux-arm64-glibc"
  | "linux-x64-glibc"
  | "linux-arm64-musl"
  | "linux-x64-musl"
  | "windows-arm64"
  | "windows-x64";

export type BunExecutableTarget =
  | "bun-darwin-arm64"
  | "bun-darwin-x64-baseline"
  | "bun-linux-arm64"
  | "bun-linux-x64-baseline"
  | "bun-linux-arm64-musl"
  | "bun-linux-x64-musl"
  | "bun-windows-arm64"
  | "bun-windows-x64-baseline";

export interface ExecutableTarget {
  archive: "tar.gz" | "zip";
  bunTarget: BunExecutableTarget;
  executableName: "osmix" | "osmix.exe";
  id: ExecutableTargetId;
  libc?: "glibc" | "musl";
  nativePackage: string;
}

export const executableTargets: readonly ExecutableTarget[] = [
  {
    archive: "tar.gz",
    bunTarget: "bun-darwin-arm64",
    executableName: "osmix",
    id: "macos-arm64",
    nativePackage: "@opentui/core-darwin-arm64",
  },
  {
    archive: "tar.gz",
    bunTarget: "bun-darwin-x64-baseline",
    executableName: "osmix",
    id: "macos-x64",
    nativePackage: "@opentui/core-darwin-x64",
  },
  {
    archive: "tar.gz",
    bunTarget: "bun-linux-arm64",
    executableName: "osmix",
    id: "linux-arm64-glibc",
    libc: "glibc",
    nativePackage: "@opentui/core-linux-arm64",
  },
  {
    archive: "tar.gz",
    bunTarget: "bun-linux-x64-baseline",
    executableName: "osmix",
    id: "linux-x64-glibc",
    libc: "glibc",
    nativePackage: "@opentui/core-linux-x64",
  },
  {
    archive: "tar.gz",
    bunTarget: "bun-linux-arm64-musl",
    executableName: "osmix",
    id: "linux-arm64-musl",
    libc: "musl",
    nativePackage: "@opentui/core-linux-arm64-musl",
  },
  {
    archive: "tar.gz",
    bunTarget: "bun-linux-x64-musl",
    executableName: "osmix",
    id: "linux-x64-musl",
    libc: "musl",
    nativePackage: "@opentui/core-linux-x64-musl",
  },
  {
    archive: "zip",
    bunTarget: "bun-windows-arm64",
    executableName: "osmix.exe",
    id: "windows-arm64",
    nativePackage: "@opentui/core-win32-arm64",
  },
  {
    archive: "zip",
    bunTarget: "bun-windows-x64-baseline",
    executableName: "osmix.exe",
    id: "windows-x64",
    nativePackage: "@opentui/core-win32-x64",
  },
];

export const executableRoot = join(import.meta.dirname, "../dist/executables");
export const executableDependencyRoot = join(import.meta.dirname, "../dist/executable-native-deps");
export const hostExecutableName = process.platform === "win32" ? "osmix.exe" : "osmix";
export const hostExecutablePath = join(executableRoot, "host", hostExecutableName);
export const releaseExecutableDirectory = join(executableRoot, "release");

export function releaseArchiveName(version: string, target: ExecutableTarget): string {
  return `osmix-v${version}-${target.id}.${target.archive}`;
}

export function expectedReleaseAssetNames(version: string): string[] {
  return [...executableTargets.map((target) => releaseArchiveName(version, target)), "SHA256SUMS"];
}

export function missingReleaseAssetNames(
  version: string,
  existingNames: Iterable<string>,
): string[] {
  const existing = new Set(existingNames);
  return expectedReleaseAssetNames(version).filter((name) => !existing.has(name));
}

export function targetDefines(target: ExecutableTarget): Record<string, string> {
  const define: Record<string, string> = {
    "process.env.NODE_ENV": JSON.stringify("production"),
  };
  if (target.libc) define["process.env.OPENTUI_LIBC"] = JSON.stringify(target.libc);
  return define;
}
