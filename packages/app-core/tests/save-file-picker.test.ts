import { afterEach, describe, expect, it, vi } from "vitest";

import {
  chooseSaveTarget,
  getSaveFileSupport,
  shouldRetrySavePickerWithPolyfill,
} from "../src/lib/save-file-picker.ts";

const originalNavigator = globalThis.navigator;

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
});
describe("shouldRetrySavePickerWithPolyfill", () => {
  it("retries in automated browser contexts", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { webdriver: true },
    });

    expect(
      shouldRetrySavePickerWithPolyfill(
        new DOMException("The user aborted a request", "AbortError"),
      ),
    ).toBe(true);
  });

  it("does not retry on intentional picker cancel", () => {
    expect(
      shouldRetrySavePickerWithPolyfill(
        new DOMException("The user aborted a request", "AbortError"),
      ),
    ).toBe(false);
  });

  it("retries on security-style failures", () => {
    expect(
      shouldRetrySavePickerWithPolyfill(
        new DOMException("Blocked by browser policy", "SecurityError"),
      ),
    ).toBe(true);
  });

  it("retries on activation-related abort errors", () => {
    expect(
      shouldRetrySavePickerWithPolyfill(
        new DOMException("Must be handling a user gesture", "AbortError"),
      ),
    ).toBe(true);
  });
});

describe("chooseSaveTarget", () => {
  const options = { suggestedName: "osmix-monaco.pbf" };

  it("returns the file the native picker chose", async () => {
    const handle = { name: "chosen.pbf" } as FileSystemFileHandle;
    const picker = vi.fn(async () => handle);
    vi.stubGlobal("showSaveFilePicker", picker);

    await expect(chooseSaveTarget(options)).resolves.toEqual({ kind: "file", handle });
    expect(picker).toHaveBeenCalledWith(options);
  });

  it("downloads when the browser has no native picker", async () => {
    vi.stubGlobal("showSaveFilePicker", undefined);

    await expect(chooseSaveTarget(options)).resolves.toEqual({
      kind: "download",
      name: "osmix-monaco.pbf",
    });
  });

  it("downloads when the native picker is blocked", async () => {
    vi.stubGlobal("showSaveFilePicker", async () => {
      throw new DOMException("Blocked by browser policy", "SecurityError");
    });

    await expect(chooseSaveTarget(options)).resolves.toEqual({
      kind: "download",
      name: "osmix-monaco.pbf",
    });
  });

  it("rejects when the user cancels the picker", async () => {
    vi.stubGlobal("showSaveFilePicker", async () => {
      throw new DOMException("The user aborted a request", "AbortError");
    });

    await expect(chooseSaveTarget(options)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("getSaveFileSupport", () => {
  it("reports native saving when the picker exists", async () => {
    vi.stubGlobal("showSaveFilePicker", async () => ({}));

    await expect(getSaveFileSupport()).resolves.toBe("native");
  });

  it("recognizes Brave, which turns the picker off", async () => {
    vi.stubGlobal("showSaveFilePicker", undefined);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { brave: { isBrave: async () => true } },
    });

    await expect(getSaveFileSupport()).resolves.toBe("brave-disabled");
  });

  it("reports other browsers without the picker as unsupported", async () => {
    vi.stubGlobal("showSaveFilePicker", undefined);
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });

    await expect(getSaveFileSupport()).resolves.toBe("unsupported");
  });
});
