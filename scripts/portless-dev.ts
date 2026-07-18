import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

type GitRunner = (args: readonly string[]) => string | undefined;

export function sanitizeHostnameLabel(value: string): string | undefined {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return sanitized || undefined;
}

export function detectDetachedWorktreePrefix(runGit: GitRunner): string | undefined {
  if (runGit(["rev-parse", "--abbrev-ref", "HEAD"]) !== "HEAD") return undefined;
  const gitDir = runGit(["rev-parse", "--git-dir"]);
  const commonDir = runGit(["rev-parse", "--git-common-dir"]);
  if (!gitDir || !commonDir || path.resolve(gitDir) === path.resolve(commonDir)) return undefined;
  if (path.basename(path.dirname(gitDir)) !== "worktrees") return undefined;
  return sanitizeHostnameLabel(path.basename(gitDir));
}

function runGit(args: readonly string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function createPortlessArgs(
  baseName: string,
  command: readonly string[],
  detachedPrefix: string | null = detectDetachedWorktreePrefix(runGit) ?? null,
): string[] {
  if (command.length === 0) throw new Error("Expected an underlying development command");
  const name = detachedPrefix ? `${detachedPrefix}.${baseName}` : baseName;
  return ["run", "--name", name, ...command];
}

async function main() {
  const baseName = process.argv[2];
  if (!baseName) throw new Error("Expected a Portless base name, such as merge.osmix");
  const args = createPortlessArgs(baseName, process.argv.slice(3));
  const child = spawn("portless", args, { stdio: "inherit", env: process.env });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      resolve(code ?? 1);
    });
  });
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
