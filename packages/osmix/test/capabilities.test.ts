import { afterEach, describe, expect, it, vi } from "vitest";

import { canShareArrayBuffers, getOsmixCapabilities } from "../src/capabilities";

describe("capabilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("canShareArrayBuffers", () => {
    it("is false without SharedArrayBuffer", () => {
      vi.stubGlobal("SharedArrayBuffer", undefined);
      expect(canShareArrayBuffers()).toBe(false);
    });

    it("is false with SharedArrayBuffer but no cross-origin isolation", () => {
      // The browser trap: the constructor exists but SABs cannot be posted.
      vi.stubGlobal("crossOriginIsolated", false);
      expect(canShareArrayBuffers()).toBe(false);
    });

    it("is true in a cross-origin isolated context", () => {
      vi.stubGlobal("crossOriginIsolated", true);
      expect(canShareArrayBuffers()).toBe(true);
    });

    it("is true in runtimes without crossOriginIsolated (Node)", () => {
      expect("crossOriginIsolated" in globalThis).toBe(false);
      expect(canShareArrayBuffers()).toBe(true);
    });
  });

  describe("getOsmixCapabilities", () => {
    it("does not throw without a navigator global (Node 20)", () => {
      vi.stubGlobal("navigator", undefined);
      const capabilities = getOsmixCapabilities();
      expect(capabilities.hardwareConcurrency).toBe(1);
    });

    it("limits maxWorkers to 1 without SharedArrayBuffer sharing", () => {
      vi.stubGlobal("Worker", class {});
      vi.stubGlobal("crossOriginIsolated", false);
      vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
      const capabilities = getOsmixCapabilities();
      expect(capabilities.webWorkers).toBe(true);
      expect(capabilities.canShareArrayBuffers).toBe(false);
      expect(capabilities.maxWorkers).toBe(1);
      expect(capabilities.recommendedMode).toBe("single-worker");
    });

    it("recommends multi-worker in a cross-origin isolated context", () => {
      vi.stubGlobal("Worker", class {});
      vi.stubGlobal("crossOriginIsolated", true);
      vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
      const capabilities = getOsmixCapabilities();
      expect(capabilities.maxWorkers).toBe(8);
      expect(capabilities.recommendedMode).toBe("multi-worker");
    });

    it("recommends in-process mode without Web Workers", () => {
      const capabilities = getOsmixCapabilities();
      expect(capabilities.webWorkers).toBe(false);
      expect(capabilities.maxWorkers).toBe(1);
      expect(capabilities.recommendedMode).toBe("in-process");
    });
  });
});
