declare module "kdbush" {
	export default class KDBush {
		constructor(
			length: number,
			nodeSize?: number,
			ArrayType?: Float64ArrayConstructor,
			BufferConstructor?: ArrayBufferConstructor | SharedArrayBufferConstructor,
		)

		/** Serialized index data buffer */
		data: ArrayBufferLike

		/** Add a point before calling finish */
		add(x: number, y: number): void

		/** Finalize the index after adding all points */
		finish(): void

		/** Query points within a bounding box; returns internal point indexes */
		range(minX: number, minY: number, maxX: number, maxY: number): number[]

		/** Query points within a radius from (x, y); returns internal point indexes */
		within(x: number, y: number, radius: number): number[]

		/** Reconstruct an index from a serialized buffer */
		static from(data: ArrayBufferLike): KDBush
	}
}
