declare module "kdbush" {
	import type {
		BufferConstructor,
		BufferType,
		TypedArray,
		TypedArrayConstructor,
	} from "../typed-arrays"

	export default class KDBush {
		constructor(
			length: number,
			nodeSize?: number,
			ArrayType?: TypedArrayConstructor,
			BufferConstructor?: BufferConstructor,
		)

		/** Number of items in the index */
		numItems: number

		/** Size of the KD-tree node */
		nodeSize: number

		/** Serialized index data buffer */
		data: BufferType

		/** Internal array of indices (used by geokdbush) */
		ids: Uint16Array | Uint32Array

		/** Internal array of coordinates [x0, y0, x1, y1, ...] (used by geokdbush) */
		coords: TypedArray

		/** Add a point before calling finish */
		add(x: number, y: number): number

		/** Finalize the index after adding all points */
		finish(): this

		/** Query points within a bounding box; returns internal point indexes */
		range(minX: number, minY: number, maxX: number, maxY: number): number[]

		/** Query points within a radius from (x, y); returns internal point indexes */
		within(x: number, y: number, radius: number): number[]

		/** Reconstruct an index from a serialized buffer */
		static from(data: BufferType): KDBush
	}
}
