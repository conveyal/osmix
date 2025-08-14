import { createReadStream, createWriteStream } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { Readable, Writable } from "node:stream"
import { fileURLToPath } from "node:url"
import { ResizeableTypedArray } from "../src/typed-arrays"

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = resolve(__dirname, "../../../fixtures")

function getPath(url: string) {
	if (url.startsWith("http")) {
		const fileName = url.split("/").pop()
		if (!fileName) throw new Error("Invalid URL")
		return join(FIXTURES_DIR, fileName)
	}
	return join(FIXTURES_DIR, url)
}

/**
 * Get file from the cache folder or download it from the URL
 */
export async function getFile(url: string): Promise<ArrayBuffer> {
	const filePath = getPath(url)
	try {
		const file = await readFile(filePath)
		return file.buffer as ArrayBuffer
	} catch (error) {
		const response = await fetch(url)
		const buffer = await response.arrayBuffer()
		await writeFile(filePath, new Uint8Array(buffer))
		return buffer
	}
}

export async function getFileReadStream(url: string) {
	await getFile(url)
	return Readable.toWeb(
		createReadStream(getPath(url)),
	) as ReadableStream<Uint8Array>
}

export async function getFileWriteStream(url: string) {
	return Writable.toWeb(
		createWriteStream(getPath(url)),
	) as WritableStream<Uint8Array>
}

export class WriteableStreamArrayBuffer extends WritableStream<
	Uint8Array<ArrayBuffer>
> {
	data = new ResizeableTypedArray(Uint8Array)
	buffer: ArrayBuffer | null = null
	constructor() {
		super({
			write: (chunk) => {
				this.data.pushMany(chunk)
			},
			close: () => {
				this.buffer = this.data.compact().buffer
			},
		})
	}
}
