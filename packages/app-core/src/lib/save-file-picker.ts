import { showSaveFilePicker } from "native-file-system-adapter";

type SavePickerOptions = Parameters<typeof showSaveFilePicker>[0];
type SaveFileHandle = Awaited<ReturnType<typeof showSaveFilePicker>>;

function getErrorDetails(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (typeof error === "object" && error != null) {
    const maybeError = error as { name?: string; message?: string };
    return {
      name: maybeError.name ?? "",
      message: maybeError.message ?? "",
    };
  }
  return { name: "", message: "" };
}

export function shouldRetrySavePickerWithPolyfill(error: unknown): boolean {
  if (globalThis.navigator?.webdriver) return true;

  const { name, message } = getErrorDetails(error);
  const lowerMessage = message.toLowerCase();

  if (
    name === "SecurityError" ||
    name === "NotAllowedError" ||
    name === "NotSupportedError" ||
    name === "TypeError"
  ) {
    return true;
  }

  if (name !== "AbortError") return false;

  // Native pickers can throw AbortError for non-user-cancel causes in
  // automated/headless or restricted contexts. Retry with polyfill only for
  // known non-interactive signals to avoid overriding intentional user cancel.
  return (
    lowerMessage.includes("activation") ||
    lowerMessage.includes("gesture") ||
    lowerMessage.includes("headless") ||
    lowerMessage.includes("not allowed") ||
    lowerMessage.includes("security")
  );
}

/** Where a save goes: a file the user picked, or a regular browser download. */
export type SaveTarget =
  | { kind: "file"; handle: FileSystemFileHandle }
  | { kind: "download"; name: string };

type NativeSaveFilePicker = (options?: SavePickerOptions) => Promise<FileSystemFileHandle>;

function nativeSaveFilePicker(): NativeSaveFilePicker | undefined {
  const picker = (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof picker === "function" ? (picker as NativeSaveFilePicker) : undefined;
}

/** Whether this browser can save straight to disk with `showSaveFilePicker`. */
export function hasNativeSaveFilePicker(): boolean {
  return nativeSaveFilePicker() !== undefined;
}

/**
 * How downloads are saved here: `native` writes straight to disk. Otherwise the file is built in
 * memory first; `brave-disabled` means Brave, where a flag turns the picker back on.
 */
export type SaveFileSupport = "native" | "brave-disabled" | "unsupported";

export async function getSaveFileSupport(): Promise<SaveFileSupport> {
  if (hasNativeSaveFilePicker()) return "native";
  const brave = (globalThis.navigator as { brave?: { isBrave?: () => Promise<boolean> } })?.brave;
  return (await brave?.isBrave?.()) === true ? "brave-disabled" : "unsupported";
}

/**
 * Ask where to save with the native picker, which only Chromium ships. Returns a download target
 * when the picker is missing or fails for a non-interactive reason. A user cancel rejects with
 * `AbortError`. Unlike the polyfill, this never returns a stand-in handle.
 */
export async function chooseSaveTarget(
  options: SavePickerOptions & { suggestedName: string },
): Promise<SaveTarget> {
  const download: SaveTarget = { kind: "download", name: options.suggestedName };
  const picker = nativeSaveFilePicker();
  if (!picker) return download;
  try {
    // Call with the global as `this`; an unbound native picker throws "Illegal invocation".
    return { kind: "file", handle: await picker.call(globalThis, options) };
  } catch (error) {
    if (!shouldRetrySavePickerWithPolyfill(error)) throw error;
    return download;
  }
}

/** Save a `Blob` through a regular browser download. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Revoking before the browser starts reading the blob can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function showSaveFilePickerWithFallback(
  options?: SavePickerOptions,
  onFallback?: (error: unknown) => void,
): Promise<SaveFileHandle> {
  try {
    return await showSaveFilePicker(options);
  } catch (error) {
    if (!shouldRetrySavePickerWithPolyfill(error)) throw error;
    onFallback?.(error);
    return showSaveFilePicker({
      ...options,
      _preferPolyfill: true,
    });
  }
}
