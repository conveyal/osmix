/**
 * Verify workspace package imports match declared package.json dependencies.
 *
 * Flags:
 * - Imports of @osmix/* or osmix not listed in dependencies/devDependencies
 * - Declared workspace deps with no import sites in packages/* (with allowlist)
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Declared deps that may be unused in source (tooling, types-only, etc.). */
const UNUSED_DEP_ALLOWLIST = new Set([
  "typescript",
  "@types/geojson",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "vitest",
  "@playwright/test",
  "@tailwindcss/vite",
  "@vitejs/plugin-react",
  "tailwindcss",
  "tw-animate-css",
  "vite",
  "mitata",
  "@mapbox/tilebelt",
  "@mapbox/vector-tile",
  "pbf",
  "comlink",
  "dequal",
  "@placemarkio/geojson-rewind",
  "flatbush",
  "geoflatbush",
  "geokdbush",
  "kdbush",
  "lineclip",
  "idb",
  "jotai",
  "react",
  "react-dom",
  "react-map-gl",
  "react-router",
  "maplibre-gl",
  "lucide-react",
  "clsx",
  "class-variance-authority",
  "cmdk",
  "tailwind-merge",
  "@base-ui/react",
  "@turf/bbox-polygon",
  "native-file-system-adapter",
  "hono",
  "@hono/node-server",
  "duckdb-wasm-kit",
  "@duckdb/duckdb-wasm",
]);

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?["']((?:@osmix\/[^"']+)|osmix)["']/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

async function findPackageDirs(): Promise<string[]> {
  const dirs: string[] = [];
  for (const parent of ["packages", "apps"]) {
    const parentPath = join(ROOT, parent);
    const entries = await readdir(parentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) dirs.push(join(parentPath, entry.name));
    }
  }
  return dirs;
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  await walk(dir, files, new Set(["node_modules", "dist"]));
  return files;
}

async function walk(dir: string, files: string[], skip: Set<string>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, files, skip);
    else if (/\.(ts|tsx|mts|js|jsx)$/.test(entry.name)) files.push(path);
  }
}

function packageNameFromImport(specifier: string): string {
  if (specifier === "osmix") return "osmix";
  const slash = specifier.indexOf("/", "@osmix/".length);
  return slash === -1 ? specifier : specifier.slice(0, slash);
}

function declaredDeps(pkgJson: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): Set<string> {
  return new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.devDependencies ?? {}),
  ]);
}

async function checkPackage(pkgDir: string): Promise<string[]> {
  const pkgPath = join(pkgDir, "package.json");
  let pkgJson: {
    name: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkgJson = JSON.parse(await readFile(pkgPath, "utf8"));
  } catch {
    return [];
  }

  const declared = declaredDeps(pkgJson);
  const sourceFiles = await collectSourceFiles(pkgDir);
  const imported = new Map<string, string[]>();
  const isPackage = pkgDir.includes("/packages/");

  for (const file of sourceFiles) {
    const content = stripComments(await readFile(file, "utf8"));
    for (const match of content.matchAll(IMPORT_RE)) {
      const specifier = match[1];
      const dep = packageNameFromImport(specifier);
      if (dep === pkgJson.name) continue;
      const rel = relative(pkgDir, file);
      const sites = imported.get(dep) ?? [];
      sites.push(`${rel}: ${specifier}`);
      imported.set(dep, sites);
    }
  }

  const errors: string[] = [];
  const relPkg = relative(ROOT, pkgDir);

  for (const [dep, sites] of imported) {
    if (!declared.has(dep)) {
      errors.push(
        `${relPkg}: imports ${dep} but it is not declared in package.json\n  ${sites[0]}`,
      );
    }
  }

  if (isPackage) {
    const allDeclared = new Set([
      ...Object.keys(pkgJson.dependencies ?? {}),
      ...Object.keys(pkgJson.devDependencies ?? {}),
    ]);

    for (const dep of allDeclared) {
      if (!dep.startsWith("@osmix/") && dep !== "osmix") continue;
      if (imported.has(dep)) continue;
      if (UNUSED_DEP_ALLOWLIST.has(dep)) continue;
      // @osmix/shared is commonly a devDependency for tsconfig presets only.
      if (dep === "@osmix/shared" && !pkgJson.dependencies?.[dep]) continue;
      errors.push(`${relPkg}: declares unused workspace dependency ${dep}`);
    }
  }

  return errors;
}

const packageDirs = await findPackageDirs();
const allErrors: string[] = [];

for (const dir of packageDirs) {
  allErrors.push(...(await checkPackage(dir)));
}

if (allErrors.length > 0) {
  console.error("Dependency check failed:\n");
  for (const err of allErrors) console.error(`- ${err}`);
  process.exit(1);
}

console.log(`Dependency check passed (${packageDirs.length} packages)`);
