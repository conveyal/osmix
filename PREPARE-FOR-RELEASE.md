# Prepare for v0.0.1

Outstanding work that needs product or engineering input before tagging the first release and publishing the accompanying blog post.

## Workspace-wide
- Confirm the packaging strategy for public packages. Every published workspace package points `main` to a `.ts` source file and lacks `exports`/`types` fields. Decide whether to ship precompiled ESM (e.g., `dist/index.js` + `.d.ts`) or require consumers to transpile TypeScript, then update `package.json` metadata accordingly.
- Populate shared package metadata (`license`, `repository`, `homepage`, `bugs`) so the published artifacts reference the main project.
- Audit checked-in build artifacts (`apps/**/dist`, per-package `node_modules/`) and decide which should be removed or ignored before the release branch is cut.

## apps/bench
- Implement `includeTags` support in the Osmix worker’s `queryBbox` handler so benchmark toggles return tagged entities.
- Replace the `generateVectorTile` stub with real vector tile output, ideally reusing `@osmix/vt`.
- Flesh out `DuckDBBenchWorker.createSpatialIndexes()` or adjust benchmark copy to note that DuckDB runs without indexes.
- Document or surface benchmark result persistence expectations (currently everything resets on refresh).

## apps/merge
- Decide whether to keep the committed `dist/` bundle or add a build step that generates artifacts for deployment on demand.
- Verify that the blog post covers the secure context requirements (`crossOriginIsolated`, COOP/COEP) and any fallbacks for Safari/Firefox.

## @osmix/core
- No blocking issues found; ensure the blog highlights dense-node requirements and the need to call `buildIndexes()` after mutating datasets.

## @osmix/change
- Finish the relation reference updates noted in `OsmixChangeset` (`TODO: replace refs in relations with new way`) and the open questions around dedupe ordering in `generateDirectChanges`.
- Complete `generateOscChanges()` or remove the public export until the OSC serializer is ready.
- Investigate the `TODO did this break with new dequal?` assertion in `packages/change/tests/merge.test.ts` and update the expected stats (or fix the regression).

## @osmix/json
- Confirm whether the package should expose bundled type definitions (`types` field) before publishing.

## @osmix/pbf
- Restore the skipped assertion in `packages/pbf/test/write.test.ts` once byte-for-byte parity is verified (`TODO: assert.equal(stream.buffer.byteLength, fileData.byteLength)`).
- Consider adding documentation about memory usage when re-materializing large PBFs (blog readers may ask for guidance).

## @osmix/raster
- Validate that consumers understand the OffscreenCanvas requirement; add a fallback plan if Node environments without ImageEncoder need support.

## @osmix/vt
- Address the `// TODO use bbox instead?` note in `encodeBinaryTile` so tile clipping does not rely solely on extent/buffer heuristics.
- Extend encoding to support relation geometries (multipolygons, routes) or explicitly document the omission in the blog.
- Decide whether tags/metadata should be threaded into encoded features for styling.

## @osmix/shared
- Evaluate whether additional shared helpers should live here (e.g., throttled loggers mentioned in `AGENTS.md`) so apps avoid duplicating utilities.

## @osmix/test-utils
- Audit placeholder fixture metadata (`way0`, `relation0`, etc.) for remote extracts before relying on them in new tests.
- Decide whether to expose more fixtures via `PBFs` or provide a documented pattern for test authors to opt into large downloads.
