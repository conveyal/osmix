import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canShareArrayBuffers,
  getOsmixCapabilities,
  getWorkerRuntime,
  selectWorkerCount,
} from "../src/capabilities";

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
      vi.stubGlobal("process", undefined);
      vi.stubGlobal("crossOriginIsolated", false);
      expect(canShareArrayBuffers()).toBe(false);
    });

    it("is true in a cross-origin isolated context", () => {
      vi.stubGlobal("process", undefined);
      vi.stubGlobal("crossOriginIsolated", true);
      expect(canShareArrayBuffers()).toBe(true);
    });

    it("is true in server runtimes without crossOriginIsolated", () => {
      expect("crossOriginIsolated" in globalThis).toBe(false);
      expect(canShareArrayBuffers()).toBe(true);
    });
  });

  describe("getOsmixCapabilities", () => {
    it("does not throw without a navigator global (Node 20)", () => {
      vi.stubGlobal("navigator", undefined);
      const capabilities = getOsmixCapabilities();
      expect(capabilities.hardwareConcurrency).toBe(1);
      expect(capabilities.workerRuntime).toBe("node");
    });

    it("limits maxWorkers to 1 without SharedArrayBuffer sharing", () => {
      vi.stubGlobal("process", undefined);
      vi.stubGlobal("Worker", class {});
      vi.stubGlobal("crossOriginIsolated", false);
      vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
      const capabilities = getOsmixCapabilities();
      expect(capabilities.webWorkers).toBe(true);
      expect(capabilities.workerRuntime).toBe("web");
      expect(capabilities.canShareArrayBuffers).toBe(false);
      expect(capabilities.maxWorkers).toBe(1);
      expect(capabilities.recommendedMode).toBe("single-worker");
    });

    it("recommends multi-worker in a cross-origin isolated context", () => {
      vi.stubGlobal("process", undefined);
      vi.stubGlobal("Worker", class {});
      vi.stubGlobal("crossOriginIsolated", true);
      vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
      const capabilities = getOsmixCapabilities();
      expect(capabilities.maxWorkers).toBe(8);
      expect(capabilities.recommendedMode).toBe("multi-worker");
    });

    it("recommends Node worker threads without a Web Worker global", () => {
      const capabilities = getOsmixCapabilities();
      expect(capabilities.webWorkers).toBe(false);
      expect(capabilities.workerRuntime).toBe("node");
      expect(capabilities.maxWorkers).toBe(capabilities.hardwareConcurrency);
      expect(capabilities.recommendedMode).toBe(
        capabilities.hardwareConcurrency > 1 ? "multi-worker" : "single-worker",
      );
    });

    it("recommends in-process mode when neither worker implementation exists", () => {
      vi.stubGlobal("process", undefined);
      vi.stubGlobal("Worker", undefined);
      expect(getWorkerRuntime()).toBe("none");
      expect(getOsmixCapabilities().recommendedMode).toBe("in-process");
    });

    it("detects a browser worker runtime independently of Node", () => {
      vi.stubGlobal("process", undefined);
      vi.stubGlobal("Worker", class {});
      expect(getWorkerRuntime()).toBe("web");
      expect(getOsmixCapabilities().workerRuntime).toBe("web");
    });

    it("detects Bun before its Node compatibility globals", () => {
      vi.stubGlobal("Bun", { version: "1.3.14" });
      vi.stubGlobal("Worker", class {});
      expect(getWorkerRuntime()).toBe("bun");
      expect(getOsmixCapabilities().workerRuntime).toBe("bun");
      expect(getOsmixCapabilities().recommendedMode).not.toBe("in-process");
    });

    it("detects Deno before optional Node compatibility globals", () => {
      vi.stubGlobal("Deno", { version: { deno: "2.7.0" } });
      vi.stubGlobal("Worker", class {});
      expect(getWorkerRuntime()).toBe("deno");
      expect(getOsmixCapabilities().workerRuntime).toBe("deno");
      expect(getOsmixCapabilities().recommendedMode).not.toBe("in-process");
    });
  });

  describe("selectWorkerCount", () => {
    it("reserves cores, applies a cap, and always returns at least one", () => {
      expect(selectWorkerCount({ hardwareConcurrency: 8, reserveCores: 1, maxWorkers: 4 })).toBe(4);
      expect(selectWorkerCount({ hardwareConcurrency: 3, reserveCores: 1, maxWorkers: 4 })).toBe(2);
      expect(selectWorkerCount({ hardwareConcurrency: 1, reserveCores: 1, maxWorkers: 4 })).toBe(1);
      expect(selectWorkerCount({ hardwareConcurrency: 8, reserveCores: 20, maxWorkers: 0 })).toBe(
        1,
      );
    });
  });
});
