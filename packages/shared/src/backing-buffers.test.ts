import { describe, expect, it } from "vitest";

import { inspectBackingBuffers } from "./backing-buffers.ts";

describe("inspectBackingBuffers", () => {
  it("distinguishes references, identities, shared buffers, and bytes", () => {
    const buffer = new ArrayBuffer(16);
    const value: Record<string, unknown> = {
      buffer,
      view: new Uint8Array(buffer),
    };
    value["cycle"] = value;
    if (typeof SharedArrayBuffer !== "undefined") {
      value["shared"] = new Uint32Array(new SharedArrayBuffer(8));
    }

    const result = inspectBackingBuffers(value);
    expect(result.references).toBe(typeof SharedArrayBuffer === "undefined" ? 2 : 3);
    expect(result.unique).toBe(typeof SharedArrayBuffer === "undefined" ? 1 : 2);
    expect(result.arrayBuffers).toBe(1);
    expect(result.shared).toBe(typeof SharedArrayBuffer === "undefined" ? 0 : 1);
    expect(result.uniqueBytes).toBe(typeof SharedArrayBuffer === "undefined" ? 16 : 24);
    expect(result.referencedBytes).toBe(typeof SharedArrayBuffer === "undefined" ? 32 : 40);
  });
});
