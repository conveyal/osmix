import * as Comlink from "comlink"

const CTORS = {
	Int8Array,
	Uint8Array,
	Uint8ClampedArray,
	Int16Array,
	Uint16Array,
	Int32Array,
	Uint32Array,
	Float32Array,
	Float64Array,
	BigInt64Array,
	BigUint64Array,
}

type TAName = keyof typeof CTORS
type TAWire = {
	name: TAName
	buffer: ArrayBuffer
	byteOffset: number
	length: number
}

Comlink.transferHandlers.set("TYPED_ARRAY", {
	canHandle: (obj: unknown): obj is ArrayBufferView =>
		ArrayBuffer.isView(obj) && !(obj instanceof DataView),

	serialize: (view: ArrayBufferView): [TAWire, Transferable[]] => {
		const name = view.constructor.name as TAName
		const wire: TAWire = {
			name,
			buffer: view.buffer as ArrayBuffer,
			byteOffset: view.byteOffset,
			length: (view as Int8Array).length,
		}
		return [wire, [wire.buffer]]
	},

	deserialize: (wire: TAWire) => {
		const Ctor = CTORS[wire.name]
		return new Ctor(wire.buffer, wire.byteOffset, wire.length)
	},
})
