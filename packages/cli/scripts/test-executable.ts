import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

import packageJson from "../package.json" with { type: "json" };
import { buildHostExecutable } from "./build-executables.ts";

function assertCommand(executable: string, args: string[], expected: string): void {
  const result = spawnSync(executable, args, { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.includes(expected)) {
    throw Error(`${executable} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function runDarwinPtySmoke(executable: string, fixture: string): void {
  const expectScript = String.raw`
set timeout 60
set executable $env(OSMIX_EXECUTABLE)
set fixture $env(OSMIX_FIXTURE)
spawn -noecho $executable $fixture
expect {
  -re {Error:} {
    send -- "q"
    expect eof
    exit 1
  }
  -re {z[0-9]+.*nodes} {
    after 1000
    send -- "q"
  }
  timeout {
    send -- "q"
    exit 1
  }
}
expect eof
catch wait result
exit [lindex $result 3]
`;
  const result = spawnSync("expect", ["-c", expectScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      COLUMNS: "80",
      LINES: "24",
      OSMIX_EXECUTABLE: executable,
      OSMIX_FIXTURE: fixture,
      TERM: "xterm-256color",
    },
    maxBuffer: 4 * 1024 * 1024,
    timeout: 65_000,
  });
  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== 0 || output.includes("ModuleNotFound")) {
    throw Error(`Standalone viewer PTY smoke failed:\n${output.slice(-4_000)}`);
  }
}

async function runPtySmoke(executable: string): Promise<void> {
  if (process.platform === "win32") {
    process.stdout.write(
      "Skipping automated PTY smoke on Windows; run:executable remains available.\n",
    );
    return;
  }

  const fixture = resolve(import.meta.dirname, "../../../fixtures/monaco.pbf");
  if (process.platform === "darwin") {
    runDarwinPtySmoke(executable, fixture);
    return;
  }

  const shellCommand = `stty cols 80 rows 24; exec ${quoteShell(executable)} ${quoteShell(fixture)}`;
  const scriptArgs = ["-qefc", shellCommand, "/dev/null"];

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("script", scriptArgs, {
      env: { ...process.env, COLUMNS: "80", LINES: "24", TERM: "xterm-256color" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let rendered = false;
    let quitSent = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(Error(`Timed out waiting for standalone viewer:\n${output.slice(-4_000)}`));
    }, 60_000);

    const record = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-2_000_000);
      if (!quitSent && output.includes("Error:")) {
        quitSent = true;
        child.stdin.write("q");
      }
      if (!quitSent && output.includes("nodes") && /z\d{1,2}/.test(output)) {
        rendered = true;
        quitSent = true;
        child.stdin.write("q");
      }
    };
    child.stdout.on("data", record);
    child.stderr.on("data", record);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (!rendered || code !== 0 || output.includes("ModuleNotFound")) {
        reject(Error(`Standalone viewer smoke failed with exit ${code}:\n${output.slice(-4_000)}`));
        return;
      }
      resolvePromise();
    });
  });
}

const executable = await buildHostExecutable();
assertCommand(executable, ["--help"], "Usage: osmix <file.osm.pbf>");
assertCommand(executable, ["--version"], `osmix ${packageJson.version}`);
await runPtySmoke(executable);
process.stdout.write(`Standalone executable smoke passed: ${executable}\n`);
