#!/usr/bin/env bun

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import packageJson from "../package.json" with { type: "json" };
import { parseCliArgs, USAGE } from "./args.ts";
import { openPbfViewer } from "./viewer.ts";

async function validateFile(filePath: string): Promise<string> {
  const absolutePath = resolve(filePath);
  let fileStats;
  try {
    fileStats = await stat(absolutePath);
  } catch {
    throw Error(`File not found: ${filePath}`);
  }
  if (!fileStats.isFile()) throw Error(`Not a file: ${filePath}`);
  return absolutePath;
}

/** Run the osmix terminal viewer CLI. */
export async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(args);
  if (parsed.kind === "help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (parsed.kind === "version") {
    process.stdout.write(`osmix ${packageJson.version}\n`);
    return;
  }
  await openPbfViewer(await validateFile(parsed.filePath));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error: unknown) => {
    process.stderr.write(`osmix: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
