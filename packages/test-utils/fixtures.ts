import { createReadStream, createWriteStream } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { Readable, Writable } from "node:stream"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, "../../")
const FIXTURES_DIR = resolve(ROOT_DIR, "fixtures")

export function getFixturePath(url: string) {
	if (url.startsWith("http")) {
		const fileName = url.split("/").pop()
		if (!fileName) throw new Error("Invalid URL")
		return join(FIXTURES_DIR, fileName)
	}
	return join(FIXTURES_DIR, url)
}

/**
 * Get file from the cache folder or download it from the URL
 */
export async function getFixtureFile(url: string): Promise<ArrayBufferLike> {
	const filePath = getFixturePath(url)
	try {
		const file = await readFile(filePath)
		return file.buffer
	} catch (_error) {
		const response = await fetch(url)
		const buffer = await response.arrayBuffer()
		await writeFile(filePath, new Uint8Array(buffer))
		return buffer
	}
}

export function getFixtureFileReadStream(url: string) {
	return Readable.toWeb(
		createReadStream(getFixturePath(url)),
	) as unknown as ReadableStream<ArrayBuffer>
}

export function getFixtureFileWriteStream(url: string) {
	return Writable.toWeb(
		createWriteStream(getFixturePath(url)),
	) as unknown as WritableStream<Uint8Array>
}

export type PbfFixture = {
	url: string
	bbox: {
		bottom: number
		top: number
		left: number
		right: number
	}
	nodesWithTags: number
	nodes: number
	ways: number
	relations: number
	node0: {
		lat: number
		lon: number
		id: number
	}
	way0: number
	relation0: number
	uniqueStrings: number
	primitiveGroups: number
}

/**
 * List of PBFs and their metadata used for testing. Cached locally in the top level fixtures directory so they can
 * be used across packages and apps.
 *
 * `monaco-250101.osm.pbf` is checked into the repository so it can be used in CI without causing repeated downloads.
 *
 * Below, we export a subset of the PBFs that we want to use for current tests.
 */
const AllPBFs: Record<string, PbfFixture> = {
	monaco: {
		url: "https://download.geofabrik.de/europe/monaco-250101.osm.pbf",
		bbox: {
			bottom: 43.483817,
			top: 43.75293,
			left: 7.408583,
			right: 7.595671,
		},
		nodesWithTags: 3_654,
		nodes: 38_995,
		ways: 5_708,
		relations: 308,
		node0: {
			lat: 43.7371175,
			lon: 7.4229093,
			id: 21911883,
		},
		way0: 4097656,
		relation0: 7385,
		uniqueStrings: 6968,
		primitiveGroups: 7,
	},
	montenegro: {
		url: "https://download.geofabrik.de/europe/montenegro-250101.osm.pbf",
		bbox: {
			bottom: 41.61621,
			top: 43.562169,
			left: 18.17282,
			right: 20.358827,
		},
		nodesWithTags: 63_321,
		nodes: 3_915_383,
		ways: 321_330,
		relations: 5_501,
		node0: {
			lat: 42.1982436,
			lon: 18.9656482,
			id: 26860768,
		},
		way0: 123,
		relation0: 123,
		uniqueStrings: 55_071,
		primitiveGroups: 532,
	},
	croatia: {
		url: "https://download.geofabrik.de/europe/croatia-250101.osm.pbf",
		bbox: {
			bottom: 42.16483,
			top: 46.557562,
			left: 13.08916,
			right: 19.459968,
		},
		nodesWithTags: 481_613,
		nodes: 23_063_621,
		ways: 2_315_247,
		relations: 39_098,
		primitiveGroups: 3_178,
		node0: {
			lat: 42.9738772,
			lon: 17.021989,
			id: 4_511_653,
		},
		way0: 123,
		relation0: 123,
		uniqueStrings: 269_315,
	},
	italy: {
		url: "https://download.geofabrik.de/europe/italy-250101.osm.pbf",
		bbox: {
			bottom: 35.07638,
			left: 6.602696,
			right: 19.12499,
			top: 47.100045,
		},
		nodesWithTags: 1_513_303,
		nodes: 250_818_620,
		ways: 27_837_987,
		relations: 100_000,
		primitiveGroups: 34_901,
		node0: {
			lat: 41.9033,
			lon: 12.4534,
			id: 1,
		},
		way0: 123,
		relation0: 123,
		uniqueStrings: 3190,
	},
	washington: {
		url: "https://download.geofabrik.de/north-america/us/washington-250101.osm.pbf",
		bbox: {
			bottom: 45.53882,
			top: 49.00708,
			left: -126.7423,
			right: -116.911526,
		},
		nodesWithTags: 1_513_303,
		nodes: 43_032_447,
		ways: 4_541_651,
		relations: 44_373,
		node0: {
			lat: 47.64248,
			lon: -122.3196898,
			id: 29445653,
		},
		way0: 123,
		relation0: 123,
		uniqueStrings: 598_993,
		primitiveGroups: 34_901,
	},
}

/**
 * A subset of the PBFs that we want to use for current tests. Do not check in changes to this list as it will cause CI to
 * attempt to download PBFs that are not checked into the repository.
 */
export const PBFs = { monaco: AllPBFs.monaco }
