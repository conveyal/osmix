# Task 005: Evaluate and conditionally implement chunked disk-backed storage

## Status

Decision-gated. Do not begin the storage-engine implementation until the discovery gate in this task produces an approved “go” decision.

## Summary

Determine whether Osmix users require very large OSM datasets to remain persistently and interactively accessible in the browser without reselecting/reparsing the source PBF and without fully materializing every core column in RAM. If that requirement is confirmed, implement a versioned, chunked, browser-disk-backed dataset store with bounded memory caching, crash-safe commits, explicit capability reporting, and overlay-compatible streaming export.

This task is deliberately conditional. OPFS or chunked storage is not a free memory optimization. It creates a second data engine with its own physical schema, indexes, cache policy, migrations, concurrency rules, recovery behavior, browser compatibility surface, and test matrix. It should be built only if measured user workflows need persistent interactive access that the current in-memory + IndexedDB architecture cannot provide.

The task must distinguish three very different outcomes:

1. **Persist the compressed PBF and reparse on open.** This improves convenience but not open latency or maximum in-memory dataset size.
2. **Persist chunked core columns, then rehydrate all chunks into RAM.** This may avoid IndexedDB structured-clone limits and improve reload speed, but it still does not allow a mandatory logical column to exceed the browser's fixed-buffer ceiling once reassembled.
3. **Query chunked columns and indexes directly from disk through a bounded page cache.** This is the only option in this family that can support datasets larger than the current single-buffer/in-memory representation, but it is also a substantial query-engine project.

Do not present outcomes 1 or 2 as Italy-scale interactive support. The Italy fixture fails because its mandatory node ID column alone requires a single 2,188,596,728-byte `Float64` buffer, 43,819,512 bytes above the tested 2,144,777,216-byte browser ceiling. Reassembling disk chunks into that same contiguous buffer will fail in exactly the same way.

## Relationship to Task 004

Complete or substantially validate Task 004 first.

Task 004 keeps a large base immutable and stores merge changes in a small overlay. That may solve the intended “large base plus localized patch” workflow while keeping the base in memory, eliminating the main reason to introduce a disk-backed query engine.

If Task 004 succeeds and users are comfortable reloading a source PBF at the start of a session, the correct decision may be **not to implement Task 005**.

If users require one or more of the following, Task 005 becomes more likely:

- reopen a multi-gigabyte prepared dataset instantly after a browser restart;
- keep many large regional datasets available without holding them all in memory;
- inspect/query a dataset whose mandatory columns exceed a single browser buffer;
- resume work without access to the original local file or remote URL;
- run repeated interactive map/tag/entity queries while only a bounded working set is resident;
- persist a very large immutable base while keeping only a small Task 004 overlay in memory.

## Current storage behavior and limitations

The Merge app currently stores completed `OsmTransferables` in IndexedDB schema version 3.

Before writing:

- rebuildable spatial indexes are omitted;
- exact unique storable bytes are calculated;
- `SharedArrayBuffer` columns are copied into `ArrayBuffer` because IndexedDB cannot store the shared buffers directly;
- metadata, load decision, and all core buffers are placed in one `StoredOsm` record.

On load:

- the complete record is retrieved;
- every `ArrayBuffer` is copied back into a `SharedArrayBuffer` when cross-worker sharing is available;
- the complete in-memory `Osm` is reconstructed;
- selected spatial indexes are rebuilt;
- the dataset is replicated to compute workers.

This design has useful properties: it is simple, atomic at the record level, fast for small datasets, and reuses the normal in-memory query implementation. Its limitations become material at large scale:

- storage requires a complete additional `ArrayBuffer` copy of every shared column;
- loading requires another complete copy back to shared buffers;
- one IndexedDB value may contain several gigabytes of buffers;
- structured clone and quota behavior varies by browser/runtime;
- spatial indexes are rebuilt after every restore;
- the entire dataset must fit in RAM before any query can run;
- each logical core column must still fit in one fixed buffer;
- listing and metadata operations currently call `getAll()` and can accidentally read full records depending on IndexedDB access patterns/implementation;
- eviction is left to browser quota management rather than an application-level dataset lifecycle.

## Phase 0: mandatory go/no-go discovery

The first deliverable is a short architecture decision record and benchmark report. Do not write production OPFS storage before this report is reviewed.

### Product questions

Answer these with concrete users/workflows rather than hypothetical future value:

1. Must a prepared dataset survive browser and machine restarts?
2. Is reselecting a local PBF acceptable?
3. Is reparsing for 1–3 minutes at session start acceptable?
4. Must the dataset remain usable if the original file/URL becomes unavailable?
5. How many large datasets must coexist on disk?
6. What is the target maximum dataset: Australia, Italy, Europe, or planet-scale?
7. Which interactions are required while disk-backed: map rendering, entity lookup, tag search, bbox queries, routing, extraction, merge, or only export?
8. What latency is acceptable for first map render, entity lookup, tag search, and panning?
9. Is Chromium-only acceptable, or must Firefox/Safari work?
10. Can users grant persistent-storage permission and tolerate browser-managed eviction?
11. Is a local native sidecar/server acceptable for workloads beyond a browser's practical range?
12. Is offline use required?

### Measurement questions

Collect measurements for Monaco, Australia, Italy, and one synthetic dataset with many small columns/chunks:

- compressed PBF bytes;
- current storable-transfer bytes;
- IndexedDB store/load time;
- transient copy peak during store/load;
- PBF reparse time;
- spatial-index rebuild time;
- first useful map render time;
- repeated tile/query latency;
- quota and persistence status;
- browser eviction behavior where testable;
- current failure phase and largest required allocation;
- Task 004 overlay memory for the target merge scenario.

### Alternatives to compare

Score at least these options:

| Option                                        | Persistence      | Open cost                        | Supports columns beyond one buffer | Interactive complexity                  |
| --------------------------------------------- | ---------------- | -------------------------------- | ---------------------------------- | --------------------------------------- |
| Current IndexedDB transfer snapshot           | Yes              | Full record copy + index rebuild | No                                 | Low                                     |
| Re-prompt/re-fetch and stream PBF             | Source-dependent | Reparse                          | No                                 | Low                                     |
| Persist compressed PBF in OPFS, then reparse  | Yes              | Reparse                          | No                                 | Low–medium                              |
| Chunked OPFS columns, fully rehydrate on open | Yes              | Chunk reads + full RAM rebuild   | No                                 | Medium                                  |
| Chunked disk-backed reader with bounded cache | Yes              | Open manifest + demand paging    | Yes                                | Very high                               |
| Local native sidecar/server                   | Yes              | Service-dependent                | Yes                                | High, but outside browser memory limits |

### Go criteria

Proceed to production implementation only if all are true:

- a named workflow requires persistence across sessions;
- reparsing/reselection is demonstrably unacceptable;
- the current IndexedDB snapshot cannot meet the workflow safely;
- Task 004 alone does not meet the workflow;
- target browser support is agreed;
- the team accepts schema migration, cache eviction, and corruption-recovery ownership;
- the required query set is narrow enough to implement and test;
- a browser solution is still preferable to a native/server path.

### No-go outcome

A no-go decision is a valid completion of Phase 0. Document the evidence and retain the current architecture. Possible smaller improvements include:

- store only the compressed source PBF in OPFS and reparse it;
- persist file handles/URLs when browser permissions allow;
- improve IndexedDB metadata-only queries;
- offer explicit “keep for offline use” behavior for small datasets;
- rely on Task 004 overlays and streaming export;
- direct truly large workflows to a native/server tool.

## Scope if the decision is “go”

If the requirement is only “persist source bytes and reparse,” implement that narrow feature and stop. Do not build the column/query system described below.

If the approved requirement is persistent **interactive** access with bounded memory or support for columns larger than one buffer, implement the disk-backed reader architecture below.

## Architectural principles

1. Keep `@osmix/core` independent of browser filesystem APIs.
2. Treat disk datasets as immutable, content-addressed generations.
3. Keep metadata/catalog transactions small and separate from bulk bytes.
4. Store every large logical column as independently checksummed chunks below a configured maximum size.
5. Never concatenate a logical column merely to satisfy an existing typed-array API.
6. Use a bounded LRU/page cache with observable hit/miss/eviction metrics.
7. Make cancellation and worker restart safe at chunk boundaries.
8. Commit atomically through catalog state/generation pointers rather than assuming directory rename semantics.
9. Detect corruption precisely and preserve the source/recovery path.
10. Design for Task 004: immutable disk base plus in-memory overlay plus streaming export.

## Proposed component boundaries

### Generic storage interface

Define a runtime-neutral chunk-store abstraction that can be tested in memory and implemented by OPFS in Merge. Do not import DOM filesystem types into `@osmix/core`.

```ts
interface ChunkStore {
  read(key: string, options?: { offset?: number; length?: number }): Promise<Uint8Array>;
  write(key: string, bytes: Uint8Array): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  exists(key: string): Promise<boolean>;
}
```

Add streaming methods if measurements show that whole-chunk reads are still too large. Keep chunks small enough that normal reads remain bounded.

Recommended layering:

- schema/manifest/codec logic in a new package only if multiple apps/runtimes will use it;
- OPFS implementation and browser permission/UI in `apps/merge` initially;
- in-memory fake implementation in tests;
- optional Node filesystem adapter later, behind the same interface, if it provides meaningful parity.

Do not move browser-specific persistence into `@osmix/pbf` or `@osmix/core`.

### Metadata catalog

Retain IndexedDB for small catalog records only. A catalog entry should include:

- content hash / dataset ID;
- file name, source URL, source size, and timestamps;
- storage format version;
- OSM transfer/content-hash semantic versions;
- committed generation ID;
- state: `writing`, `ready`, `corrupt`, or `deleting`;
- manifest location and checksum;
- total physical bytes and logical bytes;
- entity counts and bbox;
- available persisted/query capabilities;
- load profile/decision provenance;
- last-accessed time and pin/persistence preference;
- optional source recovery information;
- schema migration status.

Catalog listing must never read bulk column chunks.

### On-disk layout

Use content-addressed dataset directories and generation-specific writes. One possible layout:

```text
datasets/
  <sha256>/
    generations/
      <generation-id>/
        manifest.json
        string-table/
          bytes/000000.bin
          offsets/000000.bin
        nodes/
          ids/000000.bin
          ids/000001.bin
          lons/000000.bin
          lats/000000.bin
          tags-presence/000000.bin
          tags-offsets/000000.bin
        ways/
          ids/000000.bin
          ref-start/000000.bin
          ref-count/000000.bin
          refs/000000.bin
        relations/
          ...
        indexes/
          id-directory.bin
          tag-directory.bin
          spatial-directory.bin
```

Do not depend on filesystem rename/move being atomic or universally implemented. Write a new generation under a unique ID, close/sync all handles, validate checksums, then atomically update the small IndexedDB catalog pointer to mark that generation ready. Orphaned unreferenced generations can be cleaned on startup.

### Manifest

The manifest must be sufficient to reject incompatible or partial datasets without opening every file.

Recommended fields:

```ts
interface DiskOsmManifest {
  formatVersion: number;
  transferVersion: number;
  contentHashVersion: number;
  datasetId: string;
  generationId: string;
  createdAt: number;
  entityCounts: { nodes: number; ways: number; relations: number };
  bbox: GeoBbox2D;
  chunkTargetBytes: number;
  columns: Record<string, DiskColumnManifest>;
  indexes: Record<string, DiskIndexManifest>;
  capabilities: DiskOsmCapabilities;
  logicalBytes: number;
  physicalBytes: number;
  checksumAlgorithm: "sha256";
}
```

Each column manifest should record element type, logical length, encoding, chunk order, byte offsets/ranges, element ranges, per-chunk checksum, and optional compression. Keep versioning independent from `OsmTransferables`; the disk schema will evolve for different reasons.

## Chunk design

### Chunk size

Choose chunk size by benchmark, not intuition. Start evaluation around 16–64 MiB, which is large enough to avoid excessive filesystem metadata but small enough for bounded reads/copies. Test smaller chunks for random entity access and larger chunks for sequential export.

The manifest must support a different final chunk length. Never assume power-of-two logical entity counts.

### Fixed-width columns

IDs, coordinates, starts, counts, and similar fixed-width columns can map global element index to chunk and local index directly:

```text
chunk = floor(globalIndex / elementsPerChunk)
local = globalIndex % elementsPerChunk
```

Decode chunks into typed-array views without copying when alignment permits. Validate endianness explicitly in the format even though supported browser platforms are normally little-endian.

### Variable-width columns

Tags, string bytes, way refs, roles, and relation members cross fixed-width entity boundaries. Their start/count columns should refer to global logical offsets. The reader resolves the affected data chunks and assembles only the requested entity's small slice.

Handle a single unusually large entity whose payload spans multiple chunks. Tests must include a way/relation/tag collection crossing a chunk boundary at every possible start/end position.

### Checksums and corruption

Checksum every chunk and the manifest. Decide whether checksums are verified:

- eagerly on write;
- lazily on first read;
- fully during an explicit “verify stored dataset” action.

A failed checksum must identify dataset, generation, column, and chunk. Mark the generation corrupt in the catalog, stop serving queries from it, and offer deletion/reimport. Do not return partial or silently zero-filled entity data.

## Building a disk dataset without full materialization

If the goal includes Italy-scale support, writing an already materialized `Osm` into chunks is insufficient. The PBF loader must be able to build chunked columns directly while streaming.

### Entity order

Current PBF ingestion already requires dense nodes and type/ID ordering for direct way-reference resolution. Preserve and validate that ordering.

### Node IDs and lookups

Write sorted node ID chunks incrementally and create a small directory of per-chunk minimum/maximum IDs plus sparse anchors. Way ingestion can resolve a node ID by:

1. binary-searching the in-memory chunk directory;
2. reading or consulting a cached node-ID chunk;
3. binary-searching within that chunk;
4. producing a global node index.

This avoids constructing one giant `Float64Array` while preserving indexed way references. Benchmark the random lookup pattern generated by real PBF way refs; if it thrashes, use larger ID pages, a multi-level directory, or a temporary disk-backed hash/sort phase.

### Tags and reverse indexes

Write sparse tag presence and offsets in chunks. Building a global reverse-key index may require external sorting or per-key posting chunks. Do not collect all entity indexes for a common key in JavaScript arrays.

Possible approach:

1. Append `(keyIndex, entityType, entityIndex)` triples to bounded run files.
2. Sort each run in memory.
3. Merge sorted runs into per-key posting chunks.
4. Write a key directory with posting ranges/counts.

This is more work than current in-memory `Map<number, number[]>` finalization and must be included in the estimate before claiming disk-backed tag search.

### Ways and relations

Write fixed-width metadata and variable-width refs/members separately. Preserve missing way refs losslessly. Relation members can refer forward to relations; disk storage should preserve IDs and resolve lazily where appropriate rather than requiring every target to exist during ingestion.

### Crash safety

Every import writes to a non-ready generation. Cancellation or worker termination leaves no ready catalog entry. On startup, delete abandoned `writing` generations after a grace period or expose a recovery/cleanup action.

## Disk-backed reader

### Reader contracts

Implement the read-only contracts introduced by Task 004. A `DiskOsmReader` must not imitate concrete `Nodes`/`Ways`/`Relations` arrays. It should expose async operations where disk I/O is possible.

This likely requires an async reader family rather than forcing synchronous existing methods to block:

```ts
interface AsyncEntityReader<T> {
  getById(id: number, signal?: AbortSignal): Promise<T | null>;
  search(key: string, value?: string, signal?: AbortSignal): AsyncIterable<T>;
  sorted(signal?: AbortSignal): AsyncIterable<T>;
}
```

Do not hide asynchronous disk reads behind synchronous methods or synchronous Comlink calls.

### Page cache

Add a bounded cache keyed by dataset generation, column/index, and chunk number.

Required behavior:

- explicit byte budget;
- LRU or measured replacement policy;
- request coalescing so concurrent reads share one promise;
- pin/refcount while a query uses a page;
- cancellation of unneeded reads where the API permits;
- checksum verification before publishing a page;
- separate metrics for hits, misses, reads, bytes, evictions, and wait time;
- complete invalidation when a generation is deleted or superseded;
- no cache key collision across schema versions/generations.

Avoid duplicating large caches in every compute worker without measurement. Candidate models:

1. A storage/control worker serves decoded query results to compute workers.
2. Each compute worker opens OPFS read-only with a small per-worker cache.
3. A dedicated I/O worker loads chunks into shareable buffers and publishes immutable pages.

Prototype at least models 1 and 2. Select based on tile throughput, contention, memory duplication, and recovery complexity.

## Disk indexes required for interactivity

Persisting columns alone provides sequential iteration and ID lookup but not responsive map/query behavior.

### ID index

Use a small in-memory directory of sorted ID chunk ranges and sparse anchors. This should support O(log number of chunks + log chunk size) lookup with at most one or two page reads when warm.

### Tag index

Persist a dictionary from string key/value to posting-list ranges. Posting lists must be chunked and streamable. Search should avoid loading all results when the UI paginates.

### Spatial index

The current indirect KD permutation assumes the complete coordinate columns and permutation are synchronously addressable. It cannot simply be split into arbitrary files without changing traversal I/O behavior.

Evaluate disk-friendly alternatives:

- a coarse geographic grid/tile directory with entity postings per cell;
- a packed, paged R-tree;
- a two-level KD structure with a resident top level and chunk-local leaves;
- precomputed tile-feature indexes for rendering plus separate precise entity queries.

The first implementation should optimize for the approved product queries, not reproduce every in-memory algorithm. If the requirement is map rendering and entity inspection, a tile/grid candidate index may be much simpler than disk-backed arbitrary-radius nearest-neighbor search.

Spatial results must still handle antimeridian, poles, inclusive boundaries, exact haversine filtering where promised, deterministic ordering, and overlay shadowing from Task 004.

### Way/relation geometry

Rendering a way may read its ref range, several node-ID/index pages, and coordinate pages. Add batch APIs that collect/sort required page keys before reading, avoiding one I/O operation per node. Use similar batching for relation member geometry.

## Integration with Task 004 overlays

The intended composition is:

```text
immutable DiskOsmReader base
        +
small in-memory OsmOverlay
        =
logical OverlayOsmReader
```

The overlay remains in memory and uses its own small indexes. Queries combine disk-base candidates with overlay candidates and suppress shadowed disk IDs. Streaming export merge-joins disk base iterators with sorted overlay changes.

This avoids writing a new multi-gigabyte disk generation after every merge stage. Persisting an overlay session can be a separate small record/log if users need session recovery, but do not rewrite the immutable base.

## Worker and concurrency model

### Ownership

- The control worker owns imports, writes, catalog mutations, generation commits, and overlay mutation.
- Compute workers perform read-only queries against a committed generation.
- No worker reads a generation until the catalog marks it ready.
- A generation is immutable after commit.

### File handles

Feature-detect the target browser's OPFS APIs at runtime. Verify whether synchronous access handles are available only in dedicated workers for the supported Chromium versions. Provide an async fallback where practical, but do not claim unsupported browser compatibility.

Never store live file handles inside transferables or assume they can be shared through Comlink. Reopen paths/handles per worker or centralize I/O according to the selected cache model.

### Cancellation and failure

Long imports, checksums, external sorts, migrations, and exports must accept `AbortSignal`. Cancellation should:

- stop scheduling new reads/writes;
- close access handles;
- leave the current committed generation untouched;
- mark/delete the uncommitted generation;
- clear progress state without reporting a capacity error.

Worker restart recovery should reopen the committed generation from catalog metadata. It must not replay an interrupted write as committed.

## Quota, persistence, eviction, and privacy

### Quota

Before import, estimate physical bytes with conservative overhead for manifests, indexes, temporary sort runs, and dual generations during migration. Do not compare quota only with compressed PBF size.

Because browser estimates are advisory, handle quota exhaustion during every write and report:

- requested dataset/phase;
- bytes written so far;
- estimated remaining bytes;
- reported quota/usage;
- cleanup options.

### Persistence request

If the browser exposes persistent-storage APIs, make persistence an explicit user action with a clear explanation. Report whether storage is persisted or evictable. Do not imply that OPFS guarantees permanent retention.

### Eviction policy

Add application-level dataset lifecycle controls:

- physical bytes per dataset;
- last accessed;
- pinned/persisted state;
- delete;
- verify integrity;
- optional cleanup of least-recently-used unpinned datasets;
- orphan generation/temp-run cleanup.

Never automatically delete a user dataset merely because a new import needs space without explicit product approval and visible policy.

### Privacy

OSM data and overlays remain local to the origin. Document that clearing site data/browser storage removes the dataset. Avoid logging local paths, entity contents, or source credentials. Source URLs with signed query strings should be sanitized before persistence/logging.

## Format versioning and migrations

Use a disk-format version independent from IndexedDB database version and `OsmTransferables.transferVersion`.

Migration rules:

- never mutate a ready generation in place;
- write a new generation, validate it, then switch the catalog pointer;
- retain the old generation until the switch succeeds;
- clean the old generation only after success;
- estimate space for both generations before migration;
- allow “delete and reimport” when migration would be too expensive;
- keep source hash and semantic content-hash version explicit;
- fail closed on unknown required fields/encodings.

Include a human-readable format document and small golden fixtures for each supported version.

## User experience

Only expose controls that match implemented capabilities.

Recommended UI states:

- **Importing:** progress by PBF bytes, entity counts, current column/index phase, disk bytes, and estimated remaining work.
- **Ready (memory):** current behavior.
- **Ready (disk-backed):** disk icon/label, resident cache bytes, persisted capabilities, and first-query warming state.
- **Evictable:** browser may remove this dataset; offer a persistence request when supported.
- **Corrupt:** identify failed generation/chunk and offer delete/reimport.
- **Migration required:** show required temporary space and allow deferral/deletion.
- **Source-only persisted:** explain that opening reparses the PBF.

File info should distinguish:

- compressed source bytes;
- logical column bytes;
- physical disk bytes;
- resident cache bytes;
- overlay bytes;
- browser quota/usage;
- persisted/evictable status;
- available query/spatial/tag capabilities.

Do not label a source-only or fully-rehydrated snapshot as “disk-backed interactive.”

## Implementation phases after approval

### Phase 1: storage abstraction, catalog, and crash-safe generation writes

1. Add in-memory `ChunkStore` test implementation.
2. Add OPFS feature detection and implementation in Merge.
3. Define manifest/catalog schemas and version checks.
4. Implement generation write/validate/commit/delete.
5. Add orphan cleanup and integrity verification.
6. Store a small synthetic fixed-width dataset and reopen it.

### Phase 2: sequential chunked core columns

1. Encode/decode all v2 core columns in chunks.
2. Support variable-width ranges across chunk boundaries.
3. Stream an existing small `Osm` to disk and stream it back to PBF without full rehydration.
4. Differentially compare entities and semantic hashes.
5. Measure whether compression is useful per column; do not add it without a clear storage/I/O win.

### Phase 3: streaming PBF-to-disk construction

1. Add disk-backed column builders.
2. Add chunk ID directory and node ref resolution.
3. Add external-run construction for tag postings if tag search is required.
4. Preserve missing refs and relation members.
5. Ensure cancellation/crash never publishes a partial generation.
6. Load Italy without allocating its complete node-ID column in one buffer.

### Phase 4: bounded disk reader and ID/entity inspection

1. Add async reader contracts.
2. Add page cache and instrumentation.
3. Implement ID lookup and entity decode.
4. Implement batched way/relation geometry reads.
5. Integrate entity inspection in Merge.

### Phase 5: approved interactive indexes

Implement only the indexes required by the Phase 0 product decision:

- tag postings/search if required;
- disk spatial directory/index if map rendering/bbox queries are required;
- tile-oriented feature index if that is the narrower rendering target;
- radius/routing support only with separate approval and performance evidence.

### Phase 6: overlays, export, recovery, and lifecycle UI

1. Compose Task 004 overlays over disk bases.
2. Stream merged PBF export.
3. Restore datasets and overlays after worker restart.
4. Add storage management, persistence status, corruption, migration, and cleanup UI.
5. Add documentation, changeset, browser compatibility matrix, and manual large-dataset checklist.

## Testing plan

### Schema and codec tests

- Golden manifest parsing for every version.
- Reject unknown/incompatible versions and malformed lengths.
- Fixed-width chunks with zero, one, exact-boundary, boundary+1, and final-short chunks.
- Variable-width records starting/ending across every chunk boundary.
- Endianness and typed-array alignment validation.
- Per-chunk and manifest checksum failures.
- Logical/physical byte accounting.
- Source/content hash preservation.

### Transaction and recovery tests

- Crash/cancel before first chunk, mid-column, during index build, after manifest, and before catalog commit.
- Existing committed generation remains readable after every failure point.
- Orphan cleanup removes only unreferenced generations.
- Migration switches atomically and preserves the old generation on failure.
- Quota exhaustion produces structured diagnostics and no ready partial dataset.
- Concurrent readers continue using an old committed generation while a new generation is prepared.

### Reader/cache tests

- Cold/warm ID lookup.
- Concurrent read coalescing.
- LRU eviction honors byte budget and pins.
- Cancellation releases pins and does not publish corrupt partial pages.
- Dataset deletion invalidates cache entries.
- Worker restart reopens the correct generation.
- Batched geometry avoids per-node reads.
- Tag posting pagination does not materialize all results.
- Spatial queries match naive scans, including boundaries/antimeridian/poles required by the chosen index.

### Differential tests

For small randomized fixtures:

1. Load into normal in-memory `Osm`.
2. Build the disk representation.
3. Compare ID lookups, entities, tags, refs/members, sorted iteration, approved searches, and approved spatial queries.
4. Stream both to PBF, reload, and compare semantic hashes.
5. Apply the same Task 004 overlay to memory and disk readers and compare logical/export results.

### Browser integration tests

- Feature detection and unsupported-browser messaging.
- Persisted versus evictable status.
- Storage estimate and quota failure UI.
- Catalog list reads metadata without reading bulk chunks.
- Clear/delete releases files and broadcasts state.
- Tab/worker restart recovery.
- Site-data deletion behavior documentation.
- No unhandled rejections for cancellation, corruption, or quota errors.

### Large manual verification

Do not add Australia or Italy to automated tests.

For Australia:

- import directly to chunks;
- close/reopen the browser;
- reach first useful map/inspection state within the approved latency;
- verify exact counts and representative entities;
- record disk bytes, cache bytes, I/O, and timings;
- apply a small overlay and stream export.

For Italy, only if the approved scope claims beyond-single-buffer support:

- confirm no 2,188,596,728-byte node-ID allocation is attempted;
- import completes with chunked node IDs;
- inspect representative nodes/ways/relations;
- run each specifically approved interactive query;
- keep cache within its configured budget;
- close/reopen and repeat without reparsing;
- stream export and reload/validate through an appropriate environment.

## Acceptance criteria for source-only persistence

Use these only if Phase 0 selects the narrow compressed-PBF option:

- Source PBF is written incrementally without a whole-file buffer.
- A committed catalog entry survives restart.
- Reopen reparses the source with accurate progress and cancellation.
- Quota/corruption/eviction states are visible and recoverable.
- UI clearly states that open time and in-memory limits are unchanged.

## Acceptance criteria for disk-backed interactive access

- A dataset opens from a committed generation without loading all core columns into RAM.
- No logical column is concatenated into a buffer larger than the configured chunk/page budget.
- Resident page-cache bytes remain within the configured limit under sustained queries.
- Required ID, entity, tag, spatial, and rendering operations meet the approved latency targets.
- Sequential PBF export is streaming and does not materialize the complete dataset or output.
- Task 004 overlays compose over the disk base with semantic parity.
- Crash, cancellation, quota exhaustion, corruption, migration failure, and worker restart preserve the last valid generation.
- Storage management accurately reports physical bytes, cache bytes, persistence/eviction status, and capabilities.
- Unsupported browsers receive a clear fallback rather than a broken control.
- Italy is claimed as supported only if its exact manual acceptance passes without the oversized mandatory allocation.
- All affected workspaces/dependents, browser integration tests, root tests, dependency checks, build, and runtime smoke tests pass.

## Risks and mitigations

### Risk: building a database when reparsing is adequate

Mitigation: enforce Phase 0 and require named workflows, measurements, and approval. A no-go outcome is successful planning, not failure.

### Risk: chunked persistence is mistaken for chunked querying

Mitigation: use distinct capability names and UI labels. Test that interactive mode never concatenates columns.

### Risk: random I/O makes map rendering unusable

Mitigation: prototype disk-friendly indexes and batch geometry reads before committing to the full schema. Optimize for the approved query set.

### Risk: cache duplication across workers consumes as much RAM as the dataset

Mitigation: compare centralized I/O versus per-worker caches, expose cache bytes per worker, and keep explicit budgets.

### Risk: OPFS/browser behavior changes or differs across browsers

Mitigation: feature-detect, maintain a tested compatibility matrix, isolate OPFS behind `ChunkStore`, and provide a source-reparse fallback.

### Risk: browser eviction destroys user work

Mitigation: report persistence status, keep overlays/exportable, document site-data behavior, and never imply guaranteed retention.

### Risk: schema migrations temporarily require double disk space

Mitigation: estimate first, allow delete/reimport, and never overwrite the current generation in place.

### Risk: external sorting/tag indexing greatly expands implementation scope

Mitigation: approve the exact interactive query set during Phase 0. If tag search is not required, do not build its disk index.

### Risk: browser is the wrong platform for target scale

Mitigation: compare a native sidecar/server explicitly. Stop if browser storage/query complexity exceeds the product value.

## Likely files and packages

The exact locations depend on the Phase 0 scope, but likely areas include:

- new task-specific storage/manifest/codec modules, initially app-local or in a justified `@osmix/storage` package;
- Task 004 read contracts in `packages/core/src/contracts.ts`;
- `packages/load` streaming entity/PBF adapters;
- `packages/osmix` async reader and worker orchestration APIs;
- `apps/merge/src/workers/osm.worker.ts` or a dedicated storage worker;
- `apps/merge/src/lib/merge-remote.ts`;
- `apps/merge/src/lib/storage-utils.ts`;
- `apps/merge/src/settings.ts` and storage schema/catalog modules;
- stored dataset list, File info, Activity, failure diagnostics, and capability gates;
- browser-only integration/e2e tests;
- storage format documentation and manual acceptance checklist.

## Handoff notes

The first developer assigned to this task should produce the Phase 0 ADR and benchmark report before opening a production implementation PR. Include a recommendation among: keep current IndexedDB, persist source PBF only, implement chunked snapshots with full rehydration, implement true disk-backed interactivity, or use a native/server path.

If the decision is true disk-backed interactivity, split the work into reviewable pull requests. Do not combine OPFS plumbing, a new physical schema, streaming construction, cache/query execution, spatial indexing, overlays, and UI into one change. Keep golden formats and differential tests from the first schema PR onward, because every later layer depends on their correctness.
