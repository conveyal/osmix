import { Readable, Writable } from "node:stream"
import zlib from "node:zlib"

const compression = {
	deflate: zlib.createDeflate,
	"deflate-raw": zlib.createDeflateRaw,
	gzip: zlib.createGzip,
}

export class CompressionStream {
	readable: ReadableStream<Uint8Array<ArrayBufferLike>>
	writable: WritableStream<Uint8Array<ArrayBufferLike>>
	constructor(format: keyof typeof compression) {
		const handle = compression[format]()
		this.readable = Readable.toWeb(handle) as unknown as ReadableStream<
			Uint8Array<ArrayBufferLike>
		>
		this.writable = Writable.toWeb(handle) as unknown as WritableStream<
			Uint8Array<ArrayBufferLike>
		>
	}
}

const decompression = {
	deflate: zlib.createInflate,
	"deflate-raw": zlib.createInflateRaw,
	gzip: zlib.createGunzip,
}

export class DecompressionStream {
	readable: ReadableStream<Uint8Array<ArrayBufferLike>>
	writable: WritableStream<Uint8Array<ArrayBufferLike>>
	constructor(format: keyof typeof decompression) {
		const handle = decompression[format]()
		this.readable = Readable.toWeb(handle) as unknown as ReadableStream<
			Uint8Array<ArrayBufferLike>
		>
		this.writable = Writable.toWeb(handle) as WritableStream<
			Uint8Array<ArrayBufferLike>
		>
	}
}

globalThis.DecompressionStream =
	globalThis.DecompressionStream ?? DecompressionStream
globalThis.CompressionStream = globalThis.CompressionStream ?? CompressionStream
