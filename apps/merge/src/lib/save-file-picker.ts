import { showSaveFilePicker } from "native-file-system-adapter"

type SavePickerOptions = Parameters<typeof showSaveFilePicker>[0]
type SaveFileHandle = Awaited<ReturnType<typeof showSaveFilePicker>>

function getErrorDetails(error: unknown): { name: string; message: string } {
	if (error instanceof Error) {
		return { name: error.name, message: error.message }
	}
	if (typeof error === "object" && error != null) {
		const maybeError = error as { name?: string; message?: string }
		return {
			name: maybeError.name ?? "",
			message: maybeError.message ?? "",
		}
	}
	return { name: "", message: "" }
}

export function shouldRetrySavePickerWithPolyfill(error: unknown): boolean {
	if (globalThis.navigator?.webdriver) return true

	const { name, message } = getErrorDetails(error)
	const lowerMessage = message.toLowerCase()

	if (
		name === "SecurityError" ||
		name === "NotAllowedError" ||
		name === "NotSupportedError" ||
		name === "TypeError"
	) {
		return true
	}

	if (name !== "AbortError") return false

	// Native pickers can throw AbortError for non-user-cancel causes in
	// automated/headless or restricted contexts. Retry with polyfill only for
	// known non-interactive signals to avoid overriding intentional user cancel.
	return (
		lowerMessage.includes("activation") ||
		lowerMessage.includes("gesture") ||
		lowerMessage.includes("headless") ||
		lowerMessage.includes("not allowed") ||
		lowerMessage.includes("security")
	)
}

export async function showSaveFilePickerWithFallback(
	options?: SavePickerOptions,
	onFallback?: (error: unknown) => void,
): Promise<SaveFileHandle> {
	try {
		return await showSaveFilePicker(options)
	} catch (error) {
		if (!shouldRetrySavePickerWithPolyfill(error)) throw error
		onFallback?.(error)
		return showSaveFilePicker({
			...options,
			_preferPolyfill: true,
		})
	}
}
