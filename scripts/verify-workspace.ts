import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface WorkspaceManifest {
  name: string;
  dir: string;
  scripts: Record<string, string>;
  dependencies: Set<string>;
  isBenchmark: boolean;
}

const rootDir = resolve(import.meta.dirname, "..");

export async function readManifest(dir: string): Promise<WorkspaceManifest | null> {
  try {
    const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      name?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    if (!manifest.name) throw Error("package.json is missing a workspace name");
    const dependencyNames = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    return {
      name: manifest.name,
      dir,
      scripts: manifest.scripts ?? {},
      dependencies: dependencyNames,
      isBenchmark: dir.includes("/apps/") && Boolean(manifest.scripts?.bench),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    const message = error instanceof Error ? error.message : String(error);
    throw Error(`Unable to read workspace manifest at ${join(dir, "package.json")}: ${message}`);
  }
}

export async function discoverWorkspaces(root = rootDir): Promise<WorkspaceManifest[]> {
  const workspaceDirs: string[] = [];
  for (const group of ["packages", "apps"]) {
    const groupDir = join(root, group);
    for (const entry of await readdir(groupDir, { withFileTypes: true })) {
      if (entry.isDirectory()) workspaceDirs.push(join(groupDir, entry.name));
    }
  }
  const manifests = await Promise.all(workspaceDirs.map((dir) => readManifest(dir)));
  return manifests.filter((manifest): manifest is WorkspaceManifest => manifest !== null);
}

export function selectWorkspaceGraph(
  workspaces: WorkspaceManifest[],
  selector: string,
): WorkspaceManifest[] {
  const normalizedSelector = selector.replaceAll("\\", "/").replace(/^\.\//, "");
  const matches = workspaces.filter((workspace) => {
    const workspacePath = relative(process.cwd(), workspace.dir).replaceAll("\\", "/");
    const rootRelativePath = relative(rootDir, workspace.dir).replaceAll("\\", "/");
    return (
      workspace.name === selector ||
      workspacePath === normalizedSelector ||
      rootRelativePath === normalizedSelector
    );
  });
  if (matches.length === 0) throw Error(`No workspace matches selector: ${selector}`);
  if (matches.length > 1) {
    throw Error(
      `Selector is ambiguous: ${selector} (${matches.map((match) => match.name).join(", ")})`,
    );
  }

  const rootName = matches[0]!.name;
  const selected = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const included = new Set([rootName]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const workspace of workspaces) {
      if (included.has(workspace.name)) continue;
      if ([...workspace.dependencies].some((dependency) => included.has(dependency))) {
        included.add(workspace.name);
        changed = true;
      }
    }
  }
  return topologicalOrder(
    [...included]
      .map((name) => selected.get(name)!)
      .filter((workspace) => !workspace.isBenchmark || workspace.name === rootName),
  );
}

export function topologicalOrder(workspaces: WorkspaceManifest[]): WorkspaceManifest[] {
  const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const remaining = new Set(workspaces.map((workspace) => workspace.name));
  const ordered: WorkspaceManifest[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((name) => {
      const workspace = byName.get(name)!;
      return [...workspace.dependencies].every(
        (dependency) => !remaining.has(dependency) || !byName.has(dependency),
      );
    });
    if (ready.length === 0) throw Error("Workspace dependency graph contains a cycle");
    ready.sort();
    for (const name of ready) {
      remaining.delete(name);
      ordered.push(byName.get(name)!);
    }
  }
  return ordered;
}

export function validateRequiredScripts(
  workspaces: WorkspaceManifest[],
  scripts = ["typecheck", "test"],
): void {
  for (const workspace of workspaces) {
    for (const script of scripts) {
      if (!workspace.scripts[script]) {
        throw Error(`Workspace ${workspace.name} is missing required script: ${script}`);
      }
    }
  }
}

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw Error(`Verification command failed: ${command} ${args.join(" ")}`);
}

async function verifySelected(
  selected: WorkspaceManifest[],
  options: { write?: boolean; style?: boolean } = {},
) {
  validateRequiredScripts(selected);
  console.log(`Selected workspaces: ${selected.map((workspace) => workspace.name).join(" -> ")}`);
  if (options.style !== false) {
    const paths = selected.map((workspace) => relative(rootDir, workspace.dir));
    run("pnpm", ["exec", "oxfmt", ...(options.write ? [] : ["--check"]), ...paths], rootDir);
    run("pnpm", ["exec", "oxlint", "--type-aware", ...paths], rootDir);
  }
  for (const workspace of selected) {
    console.log(`== ${workspace.name} ==`);
    run("pnpm", ["--filter", workspace.name, "run", "typecheck"], rootDir);
    run("pnpm", ["--filter", workspace.name, "run", "test"], rootDir);
  }
}

export async function verifyWorkspace(
  selector: string,
  options: { write?: boolean } = {},
): Promise<void> {
  const workspaces = await discoverWorkspaces();
  await verifySelected(selectWorkspaceGraph(workspaces, selector), options);
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const write = args.includes("--write");
  const selector = args.find((arg) => !arg.startsWith("--"));
  const workspaces = await discoverWorkspaces();
  if (all) {
    const selected = workspaces.filter((workspace) => !workspace.isBenchmark);
    validateRequiredScripts(selected);
    console.log(`Selected all non-benchmark workspaces (${selected.length})`);
    run("pnpm", ["run", "format:check"], rootDir);
    run("pnpm", ["run", "lint:check"], rootDir);
    run("pnpm", ["run", "test:check-docs"], rootDir);
    run("pnpm", ["run", "check:docs"], rootDir);
    await verifySelected(topologicalOrder(selected), { write, style: false });
    run("pnpm", ["run", "check:deps"], rootDir);
    run("pnpm", ["run", "test:node-smoke"], rootDir);
    return;
  }
  if (!selector)
    throw Error("Usage: pnpm run verify:workspace -- <workspace-name-or-path> [--write]");
  await verifyWorkspace(selector, { write });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
