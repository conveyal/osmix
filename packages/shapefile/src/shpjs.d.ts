declare module "shpjs" {
	import type { FeatureCollection } from "geojson"

	export interface ShpjsFeatureCollection extends FeatureCollection {
		fileName?: string
	}

	export type ShpjsResult = ShpjsFeatureCollection | ShpjsFeatureCollection[]

	export interface ShpjsInput {
		shp: ArrayBuffer | Buffer
		dbf?: ArrayBuffer | Buffer
		prj?: ArrayBuffer | Buffer | string
		cpg?: ArrayBuffer | Buffer | string
	}

	/**
	 * Parse a shapefile from various sources.
	 * @param input - URL string, ArrayBuffer of ZIP, or object with shp/dbf/prj/cpg buffers
	 * @returns GeoJSON FeatureCollection(s) with WGS84 projection
	 */
	function shp(
		input: string | ArrayBufferLike | ShpjsInput,
	): Promise<ShpjsResult>

	export default shp
}
