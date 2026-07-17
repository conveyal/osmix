import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { executableDependencyRoot } from "./executable-targets.ts";

const packageRoot = resolve(import.meta.dirname, "..");
const corePackagePath = resolve(packageRoot, "node_modules/@opentui/core/package.json");
const corePackage = JSON.parse(await readFile(corePackagePath, "utf8")) as { version: string };

await rm(executableDependencyRoot, { force: true, recursive: true });
await mkdir(executableDependencyRoot, { recursive: true });
await writeFile(
  resolve(executableDependencyRoot, "package.json"),
  `${JSON.stringify({ private: true }, null, "\t")}\n`,
);

const install = spawnSync(
  process.execPath,
  ["install", "--no-save", "--os=*", "--cpu=*", `@opentui/core@${corePackage.version}`],
  { cwd: executableDependencyRoot, stdio: "inherit" },
);
if (install.status !== 0) throw Error("Unable to prepare OpenTUI native packages.");

process.stdout.write(`Prepared OpenTUI ${corePackage.version} native packages.\n`);
