---
"osmix": minor
---

Make worker initialization work out of the box and the SharedArrayBuffer story explicit. Add `getOsmixCapabilities()`, `canShareArrayBuffers()`, `remote.mode`, an `inProcess` option, and an `osmix/worker` subpath export. Fix the published default worker URL (pointed at a nonexistent `.ts` file in dist), a browser `process.env` ReferenceError, and a Node 20 crash on import. `createRemote()` now throws a clear error in environments without Web Workers instead of silently running on the calling thread. Removes `SUPPORTS_SHARED_ARRAY_BUFFER`, `DEFAULT_WORKER_COUNT`, and `SUPPORTS_STREAM_TRANSFER` exports.
