import { createSHA256 } from "hash-wasm";

export interface IncrementalHashOptions {
  signal?: AbortSignal;
}

function abortError(): DOMException {
  return new DOMException("Hashing cancelled", "AbortError");
}

/** Hash a byte stream incrementally and cancel its reader when aborted. */
export async function hashStreamIncrementally(
  stream: ReadableStream<Uint8Array>,
  options: IncrementalHashOptions = {},
): Promise<string> {
  const { signal } = options;
  if (signal?.aborted) throw abortError();
  const hasher = await createSHA256();
  hasher.init();
  const reader = stream.getReader();
  const onAbort = () => {
    void reader.cancel("Hashing cancelled").catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw abortError();
      const { value, done } = await reader.read();
      if (signal?.aborted) throw abortError();
      if (done) break;
      hasher.update(value);
    }
    return hasher.digest("hex");
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

/** Hash File.stream(); this intentionally never materializes File.arrayBuffer(). */
export function hashFileIncrementally(
  file: Pick<File, "stream">,
  options: IncrementalHashOptions = {},
): Promise<string> {
  return hashStreamIncrementally(file.stream(), options);
}
