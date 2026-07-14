import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  checkDocumentationSources,
  DocumentationCheckError,
  extractDocumentationExamples,
} from "./check-docs.ts";

function source(markdown: string) {
  return { path: "fixtures/example.md", markdown };
}

async function captureCheckError(markdown: string, tempParent?: string) {
  try {
    await checkDocumentationSources([source(markdown)], { tempParent });
  } catch (error) {
    assert.ok(error instanceof DocumentationCheckError);
    return error;
  }
  assert.fail("Expected documentation check to fail");
}

void test("extracts multiple marked fences and ignores explicitly schematic TypeScript", () => {
  const examples = extractDocumentationExamples(
    source(
      [
        "```ts check-docs",
        'import { Osm } from "osmix";',
        "```",
        "```ts schematic",
        "partialCall(...);",
        "```",
        "```typescript check-docs monaco-pbf",
        "console.log(monacoPbf.byteLength);",
        "```",
        "```js",
        "ignored();",
        "```",
      ].join("\n"),
    ),
  );

  assert.equal(examples.length, 2);
  assert.deepEqual(
    examples.map((example) => [example.fenceNumber, example.sourceLine, example.prelude]),
    [
      [1, 2, undefined],
      [3, 8, "monaco-pbf"],
    ],
  );
});

void test("rejects unclassified TypeScript fences with the README path and fence number", () => {
  assert.throws(
    () => extractDocumentationExamples(source("```ts\nconst value = 1;\n```")),
    (error) => {
      assert.ok(error instanceof DocumentationCheckError);
      assert.match(error.diagnostics[0] ?? "", /fixtures\/example\.md:1 \(fence 1\)/);
      return true;
    },
  );
});

void test("maps missing exports, wrong arguments, and missing await to their fences", async () => {
  const error = await captureCheckError(
    [
      "```ts check-docs",
      'import { missingExport } from "osmix";',
      "console.log(missingExport);",
      "```",
      "```ts check-docs",
      'import { Osm } from "osmix";',
      'new Osm({ id: "fixture" }, "extra");',
      "```",
      "```ts check-docs",
      'import { fromPbf } from "osmix";',
      "const osm = fromPbf(new Uint8Array());",
      "console.log(osm.nodes.size);",
      "```",
    ].join("\n"),
  );

  assert.equal(error.diagnostics.length, 3);
  assert.ok(error.diagnostics.some((diagnostic) => /fence 1.*TS2305/.test(diagnostic)));
  assert.ok(error.diagnostics.some((diagnostic) => /fence 2.*TS2554/.test(diagnostic)));
  assert.ok(error.diagnostics.some((diagnostic) => /fence 3.*TS2339/.test(diagnostic)));
  assert.ok(error.diagnostics.every((diagnostic) => diagnostic.startsWith("fixtures/example.md:")));
});

void test("removes generated files after compiler failure", async () => {
  const tempParent = await mkdtemp(join(tmpdir(), "osmix-docs-test-"));
  try {
    await captureCheckError(
      '```ts check-docs\nimport { missingExport } from "osmix";\n```',
      tempParent,
    );
    assert.deepEqual(await readdir(tempParent), []);
  } finally {
    await rm(tempParent, { recursive: true, force: true });
  }
});
