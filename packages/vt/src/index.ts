import { tileToBBOX } from "@mapbox/tilebelt"
import { encodeBinaryTile } from "./encode"
import type {
	BinaryTileLoader,
	BinaryVtIndex,
	BinaryVtIndexOptions,
	GeoBbox2D,
	TileDebugInfo,
	TileIndex,
} from "./types"

export type {
	BinaryTileLoader,
	BinaryTilePayload,
	BinaryVtIndex,
	BinaryVtIndexOptions,
	EncodeTileOptions,
	EncodeTileResult,
	GeoBbox2D,
	TileDebugInfo,
	TileIndex,
} from "./types"
export { encodeBinaryTile }

const DEFAULT_CACHE_ENTRIES = 128

type CachedTile = {
	data: ArrayBuffer
	metadata: TileDebugInfo
}

class BinaryVtIndexImpl implements BinaryVtIndex {
	private cache = new Map<string, Promise<CachedTile | null>>()
	private order: string[] = []
	private readonly datasetId: string
	private readonly layerPrefix?: string
	private readonly extent?: number
	private readonly buffer?: number
	private readonly includeTileKey?: boolean
	private readonly maxCacheEntries: number
	private readonly loader: BinaryTileLoader

	constructor(loader: BinaryTileLoader, options: BinaryVtIndexOptions) {
		this.loader = loader
		this.datasetId = options.datasetId
		this.layerPrefix = options.layerPrefix
		this.extent = options.extent
		this.buffer = options.buffer
		this.includeTileKey = options.includeTileKey
		this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_CACHE_ENTRIES
	}

	async getTile(tileIndex: TileIndex) {
		const cached = await this.getOrLoadTile(tileIndex)
		return cached?.data ?? null
	}

	async getDebugMetadata(tileIndex: TileIndex) {
		const cached = await this.getOrLoadTile(tileIndex)
		return cached?.metadata ?? null
	}

	invalidate(tileIndex: TileIndex) {
		const key = this.keyOf(tileIndex)
		this.cache.delete(key)
		this.order = this.order.filter((entry) => entry !== key)
	}

	clearCache() {
		this.cache.clear()
		this.order = []
	}

	private keyOf(tileIndex: TileIndex) {
		return `${tileIndex.z}/${tileIndex.x}/${tileIndex.y}`
	}

	private async getOrLoadTile(tileIndex: TileIndex) {
		const key = this.keyOf(tileIndex)
		let entry = this.cache.get(key)
		if (!entry) {
			entry = this.loadTile(tileIndex)
			this.cache.set(key, entry)
			this.order.push(key)
			this.trimCache()
		}
		try {
			return await entry
		} catch (error) {
			this.cache.delete(key)
			this.order = this.order.filter((candidate) => candidate !== key)
			throw error
		}
	}

	private trimCache() {
		if (this.order.length <= this.maxCacheEntries) return
		while (this.order.length > this.maxCacheEntries) {
			const oldest = this.order.shift()
			if (!oldest) continue
			this.cache.delete(oldest)
		}
	}

	private async loadTile(tileIndex: TileIndex): Promise<CachedTile | null> {
		const bbox = tileToBBOX([
			tileIndex.x,
			tileIndex.y,
			tileIndex.z,
		]) as GeoBbox2D
		const payload = await this.loader({ bbox, tileIndex })
		if (!payload || (!payload.nodes && !payload.ways)) return null

		const result = encodeBinaryTile(payload, {
			datasetId: this.datasetId,
			tileIndex,
			layerPrefix: this.layerPrefix,
			extent: this.extent,
			buffer: this.buffer,
			includeTileKey: this.includeTileKey,
		})

		const metadata: TileDebugInfo = {
			bbox,
			tileKey: result.tileKey,
			byteLength: result.data.byteLength,
		}

		return { data: result.data, metadata }
	}
}

export const createBinaryVtIndex = (
	loader: BinaryTileLoader,
	options: BinaryVtIndexOptions,
): BinaryVtIndex => new BinaryVtIndexImpl(loader, options)
