import { describe, expect, it } from "vitest";

import {
  executableTargets,
  expectedReleaseAssetNames,
  missingReleaseAssetNames,
  releaseArchiveName,
  targetDefines,
} from "../scripts/executable-targets.ts";

describe("standalone executable targets", () => {
  it("covers every supported OpenTUI OS, architecture, and libc combination", () => {
    expect(executableTargets.map(({ id }) => id)).toEqual([
      "macos-arm64",
      "macos-x64",
      "linux-arm64-glibc",
      "linux-x64-glibc",
      "linux-arm64-musl",
      "linux-x64-musl",
      "windows-arm64",
      "windows-x64",
    ]);
    expect(new Set(executableTargets.map(({ nativePackage }) => nativePackage)).size).toBe(8);
  });

  it("uses baseline Bun runtimes for supported x64 targets", () => {
    const targets = new Map(executableTargets.map(({ id, bunTarget }) => [id, bunTarget]));
    expect(targets.get("macos-x64")).toBe("bun-darwin-x64-baseline");
    expect(targets.get("linux-x64-glibc")).toBe("bun-linux-x64-baseline");
    expect(targets.get("windows-x64")).toBe("bun-windows-x64-baseline");
    expect(targets.get("linux-x64-musl")).toBe("bun-linux-x64-musl");
  });

  it("defines the selected Linux libc and leaves other targets runtime-neutral", () => {
    for (const target of executableTargets) {
      const defines = targetDefines(target);
      expect(defines["process.env.NODE_ENV"]).toBe(JSON.stringify("production"));
      expect(defines["process.env.OPENTUI_LIBC"]).toBe(
        target.libc ? JSON.stringify(target.libc) : undefined,
      );
    }
  });

  it("creates stable archives and a checksum manifest", () => {
    expect(releaseArchiveName("1.2.3", executableTargets[0]!)).toBe(
      "osmix-v1.2.3-macos-arm64.tar.gz",
    );
    const names = expectedReleaseAssetNames("1.2.3");
    expect(names).toHaveLength(9);
    expect(new Set(names).size).toBe(9);
    expect(names.at(-1)).toBe("SHA256SUMS");
  });

  it("selects only missing release assets for an idempotent repair", () => {
    const names = expectedReleaseAssetNames("1.2.3");
    expect(missingReleaseAssetNames("1.2.3", names)).toEqual([]);
    expect(missingReleaseAssetNames("1.2.3", names.slice(0, -2))).toEqual(names.slice(-2));
  });
});
