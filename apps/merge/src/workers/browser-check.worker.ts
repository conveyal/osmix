import * as Comlink from "comlink"

const START_SIZE_BYTES = 2 ** 24

const BrowserCheckWorker = {
	getMaxArraySize() {
		let maxBytes = START_SIZE_BYTES
		while (true) {
			try {
				new ArrayBuffer(maxBytes)
			} catch (_error) {
				return maxBytes - 1_000_000
			}
			maxBytes += 1_000_000
		}
	},
}

export let browserCheckWorker: ReturnType<
	typeof Comlink.wrap<typeof BrowserCheckWorker>
>

const isWorker = "importScripts" in globalThis
if (isWorker) {
	Comlink.expose(BrowserCheckWorker)
}

export function createBrowserCheckWorker() {
	if (isWorker) throw new Error("Cannot create worker in worker.")
	const worker = new Worker(
		new URL("./browser-check.worker.ts", import.meta.url),
		{
			type: "module",
		},
	)
	return Comlink.wrap<typeof BrowserCheckWorker>(worker)
}
