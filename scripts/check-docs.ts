import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  API as TypeScriptApi,
  DiagnosticCategory,
  type Diagnostic as TypeScriptDiagnostic,
} from "typescript/unstable/sync";

export const DOCUMENT_PATHS = [
  "README.md",
  "packages/change/README.md",
  "packages/vt/README.md",
  "packages/gtfs/README.md",
  "packages/router/README.md",
  "packages/load/README.md",
  "packages/core/README.md",
  "packages/osmix/README.md",
] as const;

export interface DocumentationSource {
  path: string;
  markdown: string;
}

export interface DocumentationExample {
  path: string;
  fenceNumber: number;
  sourceLine: number;
  source: string;
  prelude?: string;
}

interface GeneratedExample extends DocumentationExample {
  filePath: string;
  prefixLines: number;
}

interface CompilerDiagnostic {
  filePath?: string;
  line?: number;
  column?: number;
  code: number;
  message: string;
}

interface Fence {
  character: "`" | "~";
  length: number;
  info: string;
  number: number;
  sourceLine: number;
  lines: string[];
}

export interface CheckDocumentationOptions {
  tempParent?: string;
  compilerConfigPath?: string;
}

const rootDir = resolve(import.meta.dirname, "..");
const defaultCompilerConfigPath = join(import.meta.dirname, "tsconfig.docs.json");
const typescriptLanguages = new Set(["ts", "typescript"]);
const preludes: Record<string, string> = {
  "monaco-pbf": "declare const monacoPbf: Uint8Array<ArrayBuffer>;",
  "pbf-pair": [
    "declare const monacoPbf: Uint8Array<ArrayBuffer>;",
    "declare const patchPbf: Uint8Array<ArrayBuffer>;",
  ].join("\n"),
  "change-context": [
    'declare const base: import("osmix").Osm;',
    'declare const patch: import("osmix").Osm;',
    "declare const wayId: number;",
  ].join("\n"),
  "gtfs-zip": "declare const zipData: ArrayBuffer;",
  osm: 'declare const osm: import("osmix").Osm;',
  "router-context": [
    'declare const osm: import("osmix").Osm;',
    'declare const graph: import("osmix").RoutingGraph;',
  ].join("\n"),
  "router-transfer": [
    'declare const graph: import("osmix").RoutingGraph;',
    "declare const worker: Worker;",
  ].join("\n"),
  "worker-pbf-inputs": [
    "declare const monacoPbf: Uint8Array<ArrayBuffer>;",
    "declare const patchPbf: Uint8Array<ArrayBuffer>;",
  ].join("\n"),
  "pbf-output": "declare const fileWritableStream: WritableStream<Uint8Array>;",
};

export class DocumentationCheckError extends Error {
  diagnostics: readonly string[];

  constructor(diagnostics: readonly string[]) {
    super(`Documentation example check failed with ${diagnostics.length} diagnostic(s)`);
    this.name = "DocumentationCheckError";
    this.diagnostics = diagnostics;
  }
}

function closingFence(line: string, fence: Fence): boolean {
  const trimmed = line.trim();
  if (trimmed.length < fence.length) return false;
  return trimmed.replaceAll(fence.character, "").length === 0;
}

function classifyFence(fence: Fence, path: string): DocumentationExample | string | null {
  const [language = "", marker, prelude, ...extra] = fence.info.split(/\s+/).filter(Boolean);
  if (!typescriptLanguages.has(language.toLowerCase())) return null;
  if (marker === "schematic") {
    if (prelude || extra.length > 0) {
      return `${path}:${fence.sourceLine - 1} (fence ${fence.number}) schematic fences do not accept options`;
    }
    return "schematic";
  }
  if (marker !== "check-docs") {
    return `${path}:${fence.sourceLine - 1} (fence ${fence.number}) TypeScript fence must be marked check-docs or schematic`;
  }
  if (extra.length > 0) {
    return `${path}:${fence.sourceLine - 1} (fence ${fence.number}) check-docs accepts at most one prelude name`;
  }
  if (prelude && !preludes[prelude]) {
    return `${path}:${fence.sourceLine - 1} (fence ${fence.number}) unknown check-docs prelude: ${prelude}`;
  }
  return {
    path,
    fenceNumber: fence.number,
    sourceLine: fence.sourceLine,
    source: fence.lines.join("\n"),
    prelude,
  };
}

export function extractDocumentationExamples(source: DocumentationSource): DocumentationExample[] {
  const lines = source.markdown.split(/\r?\n/);
  const examples: DocumentationExample[] = [];
  const errors: string[] = [];
  let activeFence: Fence | undefined;
  let fenceNumber = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (activeFence) {
      if (closingFence(line, activeFence)) {
        const classified = classifyFence(activeFence, source.path);
        if (typeof classified === "string") {
          if (classified !== "schematic") errors.push(classified);
        } else if (classified) {
          examples.push(classified);
        }
        activeFence = undefined;
      } else {
        activeFence.lines.push(line);
      }
      continue;
    }

    const opening = line.match(/^\s*(`{3,}|~{3,})\s*(.*?)\s*$/);
    if (!opening) continue;
    const delimiter = opening[1]!;
    fenceNumber++;
    activeFence = {
      character: delimiter[0] === "`" ? "`" : "~",
      length: delimiter.length,
      info: opening[2] ?? "",
      number: fenceNumber,
      sourceLine: index + 2,
      lines: [],
    };
  }

  if (activeFence) {
    errors.push(
      `${source.path}:${activeFence.sourceLine - 1} (fence ${activeFence.number}) unclosed code fence`,
    );
  }
  if (errors.length > 0) throw new DocumentationCheckError(errors);
  return examples;
}

function mappedDiagnostic(
  diagnostic: CompilerDiagnostic,
  generatedByPath: Map<string, GeneratedExample>,
): string {
  if (!diagnostic.filePath || diagnostic.line === undefined || diagnostic.column === undefined) {
    return `TS${diagnostic.code}: ${diagnostic.message}`;
  }

  const generated = generatedByPath.get(resolve(diagnostic.filePath));
  if (!generated) {
    const filePath = relative(rootDir, diagnostic.filePath).replaceAll("\\", "/");
    return `${filePath}:${diagnostic.line}:${diagnostic.column} TS${diagnostic.code}: ${diagnostic.message}`;
  }

  const mappedLine = Math.max(
    generated.sourceLine,
    generated.sourceLine + diagnostic.line - generated.prefixLines - 1,
  );
  return `${generated.path}:${mappedLine}:${diagnostic.column} (fence ${generated.fenceNumber}) TS${diagnostic.code}: ${diagnostic.message}`;
}

function diagnosticMessage(diagnostic: TypeScriptDiagnostic): string {
  const childMessages = diagnostic.messageChain?.map(diagnosticMessage) ?? [];
  return [diagnostic.text, ...childMessages].join("\n");
}

async function compilerDiagnostic(diagnostic: TypeScriptDiagnostic): Promise<CompilerDiagnostic> {
  if (!diagnostic.fileName) {
    return { code: diagnostic.code, message: diagnosticMessage(diagnostic) };
  }
  const source = await readFile(diagnostic.fileName, "utf8");
  const beforeDiagnostic = source.slice(0, diagnostic.pos);
  const lines = beforeDiagnostic.split(/\r?\n/);
  return {
    filePath: diagnostic.fileName,
    line: lines.length,
    column: lines.at(-1)!.length + 1,
    code: diagnostic.code,
    message: diagnosticMessage(diagnostic),
  };
}

async function compileExamples(
  generatedExamples: GeneratedExample[],
  compilerConfigPath: string,
  tempDirectory: string,
): Promise<CompilerDiagnostic[]> {
  const projectPath = join(tempDirectory, "tsconfig.json");
  await writeFile(
    projectPath,
    `${JSON.stringify({ extends: compilerConfigPath, files: generatedExamples.map(({ filePath }) => filePath) }, null, 2)}\n`,
    "utf8",
  );
  const api = new TypeScriptApi({ cwd: rootDir });
  try {
    const snapshot = api.updateSnapshot({ openProject: projectPath });
    const project = snapshot.getProject(projectPath);
    if (!project) throw new Error(`TypeScript did not open documentation project: ${projectPath}`);
    const diagnostics = [
      ...project.program.getConfigFileParsingDiagnostics(),
      ...project.program.getSyntacticDiagnostics(),
      ...project.program.getSemanticDiagnostics(),
    ].filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error);
    return await Promise.all(diagnostics.map(compilerDiagnostic));
  } finally {
    api.close();
  }
}

export async function checkDocumentationSources(
  sources: DocumentationSource[],
  options: CheckDocumentationOptions = {},
): Promise<number> {
  const examples = sources.flatMap(extractDocumentationExamples);
  const tempParent = options.tempParent ?? tmpdir();
  const tempDirectory = await mkdtemp(join(tempParent, "osmix-docs-"));

  try {
    const generatedExamples = await Promise.all(
      examples.map(async (example, index): Promise<GeneratedExample> => {
        const prelude = example.prelude ? preludes[example.prelude]! : "";
        const prefix = `export {};\n${prelude}${prelude ? "\n" : ""}`;
        const filePath = join(
          tempDirectory,
          `${String(index + 1).padStart(3, "0")}-${basename(example.path, ".md")}.ts`,
        );
        await writeFile(filePath, `${prefix}${example.source}\n`, "utf8");
        return {
          ...example,
          filePath,
          prefixLines: prefix.split("\n").length - 1,
        };
      }),
    );
    const compilerDiagnostics = await compileExamples(
      generatedExamples,
      options.compilerConfigPath ?? defaultCompilerConfigPath,
      tempDirectory,
    );
    const generatedByPath = new Map(
      generatedExamples.map((example) => [resolve(example.filePath), example]),
    );
    const diagnostics = compilerDiagnostics.map((diagnostic) =>
      mappedDiagnostic(diagnostic, generatedByPath),
    );
    if (diagnostics.length > 0) throw new DocumentationCheckError(diagnostics);
    return examples.length;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function checkDocumentationFiles(
  documentPaths: readonly string[] = DOCUMENT_PATHS,
  options: CheckDocumentationOptions = {},
): Promise<number> {
  const sources = await Promise.all(
    documentPaths.map(async (documentPath) => {
      const absolutePath = isAbsolute(documentPath) ? documentPath : join(rootDir, documentPath);
      return {
        path: relative(rootDir, absolutePath).replaceAll("\\", "/"),
        markdown: await readFile(absolutePath, "utf8"),
      };
    }),
  );
  return checkDocumentationSources(sources, options);
}

async function main(): Promise<void> {
  const requestedPaths = process.argv.slice(2);
  try {
    const exampleCount = await checkDocumentationFiles(
      requestedPaths.length > 0 ? requestedPaths : DOCUMENT_PATHS,
    );
    console.log(`Documentation examples passed (${exampleCount} checked)`);
  } catch (error) {
    if (error instanceof DocumentationCheckError) {
      for (const diagnostic of error.diagnostics) console.error(diagnostic);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
