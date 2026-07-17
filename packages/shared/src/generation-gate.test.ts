import { describe, expect, it } from "vitest";

import { GenerationGate } from "./generation-gate.ts";

describe("GenerationGate", () => {
  it("applies monotonic RPC updates in fallback mode", () => {
    const gate = GenerationGate.create({ initialGeneration: 2, shared: false });
    expect(gate.advance()).toBe(3);
    expect(gate.update(1)).toBe(3);
    expect(gate.update(5)).toBe(5);
    expect(gate.isCancelled(4)).toBe(true);
    expect(gate.isCurrent(5)).toBe(true);
  });

  it("shares atomic cancellation state across reconstructed gates", () => {
    if (typeof SharedArrayBuffer === "undefined") return;
    const dispatcher = GenerationGate.create({ initialGeneration: 7, shared: true });
    const worker = GenerationGate.fromTransferables(dispatcher.transferables());
    expect(worker.hasSharedState).toBe(true);
    dispatcher.advance();
    expect(worker.generation).toBe(8);
    expect(worker.isCancelled(7)).toBe(true);
  });

  it("does not regress shared state when reconstructing from an older descriptor", () => {
    if (typeof SharedArrayBuffer === "undefined") return;
    const dispatcher = GenerationGate.create({ initialGeneration: 3, shared: true });
    const descriptor = dispatcher.transferables();
    dispatcher.update(9);

    const worker = GenerationGate.fromTransferables(descriptor);
    expect(worker.generation).toBe(9);
    expect(dispatcher.generation).toBe(9);
  });
});
