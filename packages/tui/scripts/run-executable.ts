import { spawnSync } from "node:child_process";

import { buildHostExecutable } from "./build-executables.ts";

const executable = await buildHostExecutable();
const result = spawnSync(executable, process.argv.slice(2), { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
