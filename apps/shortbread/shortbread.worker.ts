/**
 * Extended OsmixWorker with Shortbread vector tile support.
 *
 * This demonstrates how to extend OsmixWorker with custom functionality
 * by subclassing and adding new methods.
 */

import type { Tile } from "@osmix/shared/types"
import { ShortbreadVtEncoder } from "@osmix/shortbread"
import * as Comlink from "comlink"
import { OsmixWorker } from "osmix"

/**
 * Extended worker class that adds Shortbread vector tile generation.
 */
export class ShortbreadWorker extends OsmixWorker {
	private encoders: Map<string, ShortbreadVtEncoder> = new Map()

	/**
	 * Get or create a ShortbreadVtEncoder for the given OSM id.
	 * The Osmix class extends Osm, so we can pass it directly to the encoder.
	 */
	private getEncoder(id: string): ShortbreadVtEncoder {
		let encoder = this.encoders.get(id)
		if (!encoder) {
			const osmix = this.get(id)
			encoder = new ShortbreadVtEncoder(osmix)
			this.encoders.set(id, encoder)
		}
		return encoder
	}

	/**
	 * Generate a Shortbread-compliant vector tile for the given tile coordinates.
	 * Returns the MVT-encoded tile data as a transferable ArrayBuffer.
	 */
	getShortbreadTile(id: string, tile: Tile): ArrayBuffer {
		const encoder = this.getEncoder(id)
		const data = encoder.getTile(tile)
		if (!data || data.byteLength === 0) return new ArrayBuffer(0)
		return Comlink.transfer(data, [data])
	}

	/**
	 * Get metadata about the Shortbread layers.
	 */
	getShortbreadLayerNames(): string[] {
		return ShortbreadVtEncoder.layerNames
	}

	/**
	 * Override delete to also clean up cached encoders.
	 */
	override delete(id: string) {
		this.encoders.delete(id)
		super.delete(id)
	}
}

// Expose the extended worker
Comlink.expose(new ShortbreadWorker())
