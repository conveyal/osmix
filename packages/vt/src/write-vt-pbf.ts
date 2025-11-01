import Pbf from "pbf"
import type { VtPbfLayer, VtSimpleFeature } from "./types"

type VtLayerContext = {
	feature: VtSimpleFeature
	keys: string[]
	values: unknown[]
	keycache: Record<string, number>
	valuecache: Record<string, number>
}

/**
 * Write Vector Tile Layers to a PBF buffer
 */
export default function writeVtPbf(layers: VtPbfLayer[]) {
	const pbf = new Pbf()
	for (const layer of layers) {
		pbf.writeMessage(3, writeLayer, layer)
	}
	return pbf.finish().buffer as ArrayBuffer
}

function writeLayer(layer: VtPbfLayer, pbf: Pbf) {
	pbf.writeVarintField(15, layer.version ?? 1)
	pbf.writeStringField(1, layer.name ?? "")
	pbf.writeVarintField(5, layer.extent ?? 4096)

	let context: VtLayerContext | undefined
	for (const feature of layer.features) {
		if (!context) {
			context = {
				feature,
				keys: [] as string[],
				values: [],
				keycache: {},
				valuecache: {},
			}
		} else {
			context.feature = feature
		}
		pbf.writeMessage(2, writeFeature, context)
	}

	if (!context) return
	context.keys.forEach((key) => {
		pbf.writeStringField(3, key)
	})

	context.values.forEach((value) => {
		pbf.writeMessage(4, writeValue, value)
	})
}

function writeFeature(ctx: VtLayerContext, pbf: Pbf) {
	if (ctx.feature.id !== undefined) {
		pbf.writeVarintField(1, ctx.feature.id)
	}

	pbf.writeMessage(2, writeProperties, ctx)
	pbf.writeVarintField(3, ctx.feature.type)
	pbf.writeMessage(4, writeGeometry, ctx.feature)
}

function writeProperties(ctx: VtLayerContext, pbf: Pbf) {
	Object.entries(ctx.feature.properties).forEach(([key, value]) => {
		let keyIndex = ctx.keycache[key]
		if (value === null) return // don't encode null value properties

		if (typeof keyIndex === "undefined") {
			ctx.keys.push(key)
			keyIndex = ctx.keys.length - 1
			ctx.keycache[key] = keyIndex
		}
		pbf.writeVarint(keyIndex)

		const type = typeof value
		const valueStr =
			type !== "string" && type !== "boolean" && type !== "number"
				? JSON.stringify(value)
				: value
		const valueKey = `${type}:${valueStr}`
		let valueIndex = ctx.valuecache[valueKey]
		if (typeof valueIndex === "undefined") {
			ctx.values.push(value)
			valueIndex = ctx.values.length - 1
			ctx.valuecache[valueKey] = valueIndex
		}
		pbf.writeVarint(valueIndex)
	})
}

function command(cmd: number, length: number) {
	return (length << 3) + (cmd & 0x7)
}

function zigzag(num: number) {
	return (num << 1) ^ (num >> 31)
}

function writeGeometry(feature: VtSimpleFeature, pbf: Pbf) {
	const type = feature.type
	let x = 0
	let y = 0
	feature.geometry.forEach((ring) => {
		let count = 1
		if (type === 1) {
			count = ring.length
		}
		pbf.writeVarint(command(1, count)) // moveto
		// do not write polygon closing path as lineto
		const lineCount = type === 3 ? ring.length - 1 : ring.length
		ring.forEach((xy, i) => {
			if (i >= lineCount) return
			if (i === 1 && type !== 1) {
				pbf.writeVarint(command(2, lineCount - 1)) // lineto
			}
			const dx = xy[0] - x
			const dy = xy[1] - y
			pbf.writeVarint(zigzag(dx))
			pbf.writeVarint(zigzag(dy))
			x += dx
			y += dy
		})
		if (type === 3) {
			pbf.writeVarint(command(7, 1)) // closepath
		}
	})
}

function writeValue(value: unknown, pbf: Pbf) {
	if (typeof value === "string") {
		pbf.writeStringField(1, value)
	} else if (typeof value === "boolean") {
		pbf.writeBooleanField(7, value)
	} else if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			pbf.writeDoubleField(3, value)
		} else if (value % 1 !== 0) {
			pbf.writeDoubleField(3, value)
		} else if (!Number.isSafeInteger(value)) {
			pbf.writeDoubleField(3, value)
		} else if (value < 0) {
			pbf.writeSVarintField(6, value)
		} else {
			pbf.writeVarintField(5, value)
		}
	}
}
