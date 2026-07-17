export interface BackingBufferInspection {
  /** Total buffer references, including repeated views and repeated object properties. */
  references: number;
  /** Number of distinct backing buffers. */
  unique: number;
  /** Number of distinct SharedArrayBuffer instances. */
  shared: number;
  /** Number of distinct ArrayBuffer instances. */
  arrayBuffers: number;
  /** Bytes across distinct backing buffers. */
  uniqueBytes: number;
  /** Bytes counted once per reference. */
  referencedBytes: number;
}

type BackingBuffer = ArrayBuffer | SharedArrayBuffer;

/** Check for SharedArrayBuffer without assuming the constructor exists in this runtime. */
export function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}

function isBackingBuffer(value: unknown): value is BackingBuffer {
  return value instanceof ArrayBuffer || isSharedArrayBuffer(value);
}

/** Inspect backing-buffer identity and byte usage in an arbitrarily nested value. */
export function inspectBackingBuffers(value: unknown): BackingBufferInspection {
  const visitedObjects = new WeakSet<object>();
  const uniqueBuffers = new Set<BackingBuffer>();
  let references = 0;
  let referencedBytes = 0;

  const visitBuffer = (buffer: BackingBuffer): void => {
    references++;
    referencedBytes += buffer.byteLength;
    uniqueBuffers.add(buffer);
  };

  const visit = (candidate: unknown): void => {
    if (isBackingBuffer(candidate)) {
      visitBuffer(candidate);
      return;
    }
    if (ArrayBuffer.isView(candidate)) {
      visitBuffer(candidate.buffer);
      return;
    }
    if ((typeof candidate !== "object" && typeof candidate !== "function") || !candidate) {
      return;
    }
    if (visitedObjects.has(candidate)) return;
    visitedObjects.add(candidate);
    if (candidate instanceof Map) {
      for (const [key, entry] of candidate) {
        visit(key);
        visit(entry);
      }
      return;
    }
    if (candidate instanceof Set) {
      for (const entry of candidate) visit(entry);
      return;
    }
    for (const entry of Object.values(candidate)) visit(entry);
  };

  visit(value);
  let shared = 0;
  let arrayBuffers = 0;
  let uniqueBytes = 0;
  for (const buffer of uniqueBuffers) {
    uniqueBytes += buffer.byteLength;
    if (isSharedArrayBuffer(buffer)) shared++;
    else arrayBuffers++;
  }
  return {
    references,
    unique: uniqueBuffers.size,
    shared,
    arrayBuffers,
    uniqueBytes,
    referencedBytes,
  };
}
