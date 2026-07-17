import { threadId, parentPort } from "node:worker_threads";

import * as Comlink from "comlink";
import nodeEndpoint from "comlink/dist/esm/node-adapter.mjs";

if (!parentPort) throw new Error("Expected a worker-thread parent port");

class PoolTestWorker {
  sharedBytes = null;

  ping() {
    return true;
  }

  getThreadId() {
    return threadId;
  }

  block(milliseconds) {
    const end = performance.now() + milliseconds;
    while (performance.now() < end) {
      // Deliberately keep this worker busy to verify the caller remains responsive.
    }
    return threadId;
  }

  crash() {
    process.exit(1);
  }

  installSharedBuffer(buffer) {
    this.sharedBytes = new Uint8Array(buffer);
    return buffer instanceof SharedArrayBuffer;
  }

  readSharedByte(index) {
    return this.sharedBytes?.[index];
  }

  writeSharedByte(index, value) {
    if (!this.sharedBytes) throw new Error("Shared buffer is not installed");
    this.sharedBytes[index] = value;
  }
}

Comlink.expose(new PoolTestWorker(), nodeEndpoint(parentPort));
