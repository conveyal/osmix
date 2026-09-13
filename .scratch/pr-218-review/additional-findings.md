# Additional finding during routing verification

## PBF exports overwrite replication time with milliseconds

Status: observed and not changed by the 15 approved implementation tickets. This behavior already exists on `origin/main`; it is not introduced by PR #218.

`packages/load/src/entity-stream.ts:39` overwrites `osmosis_replication_timestamp` with `Date.now()` on every export. The checked-in PBF schema, `packages/pbf/src/proto/osmformat.proto:75`, defines this field as seconds since the Unix epoch and as the replication state timestamp. JavaScript's `Date.now()` supplies milliseconds, and export time is not necessarily a valid replication state.

While checking ticket 14, repeated exports had identical decoded nodes, ways, relations, and routing manifests but different header timestamps. `osmium fileinfo` displayed implausible future dates. Canonical decoded entity streams were identical across all ten R5-tested input pairs, so this did not change the scoped route assertions. The local comparison evidence is `/tmp/osmix-ticket14-input-comparison.json`.

A follow-up should define when replication metadata can be preserved and when it must be omitted after edits or merges, use the required seconds unit, and test exported headers as well as entities. Merely replacing the timestamp with current time in seconds would still claim a replication state that the exporter has not established.
