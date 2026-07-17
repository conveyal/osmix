import { afterEach, describe, expect, it, vi } from "vitest";

import { collectTransferables, supportsReadableStreamTransfer } from "../src/utils";

afterEach(() => vi.unstubAllGlobals());

describe("collectTransferables", () => {
  it("collects each ArrayBuffer only once across nested aliases", () => {
    const buffer = new ArrayBuffer(8);
    const value = { first: buffer, nested: [{ second: buffer }] };

    expect(collectTransferables(value)).toEqual([buffer]);
  });

  it("handles cyclic containers", () => {
    const value: { buffer?: ArrayBuffer; self?: unknown } = {};
    value.buffer = new ArrayBuffer(4);
    value.self = value;

    expect(collectTransferables(value)).toEqual([value.buffer]);
  });

  it("does not transfer SharedArrayBuffers", () => {
    if (typeof SharedArrayBuffer === "undefined") return;
    const buffer = new SharedArrayBuffer(8);
    const view = new Uint8Array(buffer);

    expect(collectTransferables({ buffer, view })).toEqual([]);
  });
});

describe("supportsReadableStreamTransfer", () => {
  it.each([false, true])("closes both probe ports when posting throws: %s", (shouldThrow) => {
    const port1 = {
      close: vi.fn(),
      postMessage: vi.fn(() => {
        if (shouldThrow) throw new DOMException("unsupported", "DataCloneError");
      }),
    };
    const port2 = { close: vi.fn() };
    vi.stubGlobal(
      "MessageChannel",
      class {
        readonly port1 = port1;
        readonly port2 = port2;
      },
    );

    expect(supportsReadableStreamTransfer()).toBe(!shouldThrow);
    expect(port1.close).toHaveBeenCalledOnce();
    expect(port2.close).toHaveBeenCalledOnce();
  });
});
