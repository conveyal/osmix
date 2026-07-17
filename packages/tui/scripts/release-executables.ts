import { spawnSync } from "node:child_process";

import packageJson from "../package.json" with { type: "json" };
import { missingReleaseAssetNames } from "./executable-targets.ts";

function capture(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

const tag = `@osmix/tui@${packageJson.version}`;
const releaseAssets = capture("gh", [
  "release",
  "view",
  tag,
  "--json",
  "assets",
  "--jq",
  ".assets[].name",
]);
const existing = new Set(releaseAssets?.split("\n").filter(Boolean) ?? []);
const missing = missingReleaseAssetNames(packageJson.version, existing);
const needed = releaseAssets !== null && missing.length > 0;

process.stdout.write(`needed=${needed}\n`);
process.stdout.write(`tag=${tag}\n`);
process.stdout.write(`version=${packageJson.version}\n`);
process.stdout.write(`missing=${missing.join(",")}\n`);
