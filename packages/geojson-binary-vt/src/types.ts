export type GeoBbox2D = [number, number, number, number]

export type TileIndex = {
	x: number
	y: number
	z: number
}

export type BinaryNodeTile = {
	ids: Float64Array
	positions: Float64Array
}

export type BinaryWayTile = {
	ids: Float64Array
	positions: Float64Array
	startIndices: Uint32Array
}

export type BinaryTilePayload = {
	nodes: BinaryNodeTile | null
	ways: BinaryWayTile | null
	bounds: GeoBbox2D
	metadata: Record<string, unknown>
}

export type EncodeTileOptions = {
	datasetId: string
	tileIndex: TileIndex
	tileKey?: string
	layerPrefix?: string
	extent?: number
	buffer?: number
	includeTileKey?: boolean
	includeTags?: boolean
}

export type EncodeTileResult = {
	data: ArrayBuffer
	tileKey: string
	extent: number
}

export type TileDebugInfo = {
	bbox: GeoBbox2D
	tileKey: string
	byteLength: number
}

export type BinaryTileLoader = (params: {
	bbox: GeoBbox2D
	tileIndex: TileIndex
}) => Promise<BinaryTilePayload | null>

export type BinaryVtIndexOptions = {
	datasetId: string
	layerPrefix?: string
	extent?: number
	buffer?: number
	includeTileKey?: boolean
	maxCacheEntries?: number
}

export interface BinaryVtIndex {
	getTile(tileIndex: TileIndex): Promise<ArrayBuffer | null>
	getDebugMetadata(tileIndex: TileIndex): Promise<TileDebugInfo | null>
	invalidate(tileIndex: TileIndex): void
	clearCache(): void
}
