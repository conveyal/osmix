# Osmix follow-up tasks

This folder contains implementation-ready follow-up tasks that were deliberately left outside the Australia-scale PBF loading work. The filenames preserve the original recommendation numbers so discussion, pull requests, and future planning can refer to stable task identifiers.

| Task                                                                | Title                                                                   | Status                   | Relationship                                                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [004](./004-immutable-base-overlay-merging-and-streaming-export.md) | Keep the base immutable with overlay-based merging and streaming export | Ready for implementation | Recommended next step for reducing merge-time peak memory                                                         |
| [005](./005-conditional-chunked-disk-storage.md)                    | Evaluate and conditionally implement chunked disk-backed storage        | Decision-gated           | Start with measurement after Task 004; implement only if persistent interactive access is a confirmed requirement |

## Ordering

Task 004 should be completed before making a product decision on Task 005. Overlay-based merging removes repeated whole-dataset copies and may make the target Australia-plus-local-patch workflow practical without introducing an on-disk database. Its measurements will also show whether remaining failures are caused by persistence, working-set pressure, or individual typed-array column limits.

Task 005 intentionally begins with a go/no-go decision. It should not be treated as an automatic continuation of Task 004. Browser disk storage introduces a second storage engine, schema/versioning obligations, cache eviction behavior, and substantially more complex query execution. Those costs are justified only if users need large datasets to remain interactively queryable across sessions without reloading the source PBF, or if required datasets cannot be represented by the current in-memory columns.

## Shared constraints

- Preserve the current `@osmix/load` Full default for external callers unless a separate public API change is approved.
- Keep the Merge app's control-worker/compute-worker scheduling, recovery, shared-buffer validation, and cancellation behavior intact.
- Keep Australia-scale load/inspect/render behavior working in Auto → View mode.
- Do not claim Australia-scale merge, Italy-scale loading, or disk-backed interaction until the relevant task's explicit acceptance criteria pass.
- Add changesets and update package/app documentation when public APIs or persisted formats change.
- Follow the repository verification contract in `AGENTS.md` for every affected package and dependent.
