# Australia-scale PBF manual verification

Use this checklist for the manual large-file acceptance run. Do not add this fixture to automated tests.

## Fixture and expected result

- Path: `/Users/trevorgerhardt/gh/conveyal/osmix/fixtures/australia-260716.osm.pbf`
- File size: `952,642,672` bytes (about 908.5 MiB)
- Nodes: `133,881,054`
- Ways: `11,335,128`
- Relations: `233,762`
- Exact all-node index size: `535,524,216` bytes (510.72 MiB)
- Expected Auto selection: **View**, because the all-node index exceeds Auto's 256 MiB limit

## Environment

- [x] Use a modern Chromium browser over HTTPS or localhost.
- [x] Confirm Check System reports a secure context.
- [x] Confirm Check System reports cross-origin isolation.
- [x] Confirm `SharedArrayBuffer` is available and is the active core buffer type.
- [x] Record the reported device-memory class: **16 GiB**
- [x] Record the tested `ArrayBuffer` ceiling: **2,145,386,496 bytes**
- [x] Record the tested `SharedArrayBuffer` ceiling: **2,145,386,496 bytes**
- [x] Record the browser name and version: **HeadlessChrome 150.0.0.0**
- [x] Record the commit: **81272dff47ab plus the uncommitted implementation worktree**

## Load

- [x] Start the merge app and leave the PBF Advanced selector on **Auto**.
- [x] Select the fixture at the exact path above.
- [x] Confirm Auto selects **View** and reports the all-node-size selection reason.
- [x] Confirm capabilities report tagged nodes, ways, and relations as available.
- [x] Confirm capabilities report the all-node index as unavailable.
- [x] Confirm loading completes with exactly `133,881,054` nodes, `11,335,128` ways, and
      `233,762` relations.
- [x] Confirm the browser console contains no uncaught allocation, transfer, or worker errors.
- [x] Confirm the loading path does not create a contiguous input buffer approximately the size of the PBF.
- [x] Confirm persistence is not offered when the exact transfer size exceeds the available IndexedDB quota.
      The headless browser supplied a 10,737,420,862-byte quota, so Save was correctly offered there; the
      exact 2 GiB-quota rejection is covered by `tests/storage-utils.test.ts`.

## Functional acceptance

- [x] Fit and render the national Australia map view.
- [x] Zoom to a city and confirm tagged-node and way rendering continues to update.
- [x] Run a tag-key search and confirm results appear. Query used: **`place=city`; 72 nodes and 27 relations**
- [x] Inspect a representative node. OSM ID: **13766899 (Sydney)**
- [x] Inspect a representative way. OSM ID: **1881386**
- [x] Inspect a representative relation. OSM ID: **2503027**
- [x] Confirm an all-node-dependent control is disabled and explains that Full is required.
- [x] Confirm the disabled control offers a reload using Full rather than building the index lazily.

Australia-scale merge, deduplication, complete/smart extraction, and routing are outside this acceptance run.
Do not attempt Full merely to complete this checklist.

## Observed diagnostics

Fill these fields from the load diagnostics after the run:

- Requested profile: **Auto**
- Selected profile: **View**
- Selection reason(s): **511 MiB all-node index exceeds 256 MiB; Full's 5,343 MiB projected peak
  exceeds 4,096 MiB; View's 4,832 MiB projected peak exceeds the advisory 4,096 MiB guideline**
- Resident typed-buffer bytes: **4,543,651,992**
- Projected typed-buffer peak bytes: **5,066,657,884**
- Largest planned allocation bytes: **536,870,912**
- Exact storable-transfer bytes: **4,095,437,400**
- Working-set budget bytes: **4,294,967,296**
- Single-allocation budget bytes: **1,716,309,196.8**

## Observed phase timings

- Incremental SHA-256: **3.491 s**
- PBF parse and entity ingestion: **66.611 s**
- ID and tag finalization: **9.124 s**
- Tagged-node spatial index: **1.328 s**
- Way spatial index: **7.135 s**
- Relation spatial index: **4.030 s**
- Total load: **91.748 s end-to-end; 88.229 s after hashing**

## Outcome

- Result: **pass**
- Observed peak browser memory, if available: **9,340,837,331 bytes reported after loading by
  `performance.measureUserAgentSpecificMemory()`**. Chromium attributed the shared backing buffers to
  both the Window and worker, so this is not a physical-memory peak; modeled resident typed buffers were
  4,543,651,992 bytes.
- Notes or separately scoped blockers: **No acceptance blocker. Growth beyond the current `2^27`
  Float64 ID-capacity boundary and the remaining full-copy merge architecture stay separately scoped.**
