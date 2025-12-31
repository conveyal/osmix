import Pbf from "pbf"
import { readPrimitiveBlock, type OsmPbfBlock } from "../proto/osmformat"
import { webDecompress } from "../utils"

type DecodeRequest = {
	id: number
	compressed: ArrayBuffer
}

export type DecodeResponse =
	| {
			id: number
			block: OsmPbfBlock
	  }
	| {
			id: number
			error: string
	  }

addEventListener("message", async (e: MessageEvent<DecodeRequest>) => {
	const { id, compressed } = e.data
	try {
		const compressedBytes = new Uint8Array(
			compressed,
		) as Uint8Array<ArrayBuffer>
		const decompressed = await webDecompress(compressedBytes)
		const pbf = new Pbf(decompressed)
		const block = readPrimitiveBlock(pbf)
		const msg: DecodeResponse = { id, block }
		postMessage(msg)
	} catch (err) {
		const msg: DecodeResponse = {
			id,
			error: err instanceof Error ? err.message : String(err),
		}
		postMessage(msg)
	}
})
