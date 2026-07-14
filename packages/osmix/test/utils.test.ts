import { describe, expect, it } from "vitest";

import { collectTransferables } from "../src/utils";

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
