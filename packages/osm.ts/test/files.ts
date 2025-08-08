export const PBFs: Record<
	string,
	{
		url: string
		bbox: {
			bottom: number
			top: number
			left: number
			right: number
		}
		geoJsonFeatures: number
		nodes: number
		ways: number
		relations: number
		node0: {
			lat: number
			lon: number
			id: number
		}
		uniqueStrings: number
		primitiveGroups: number
	}
> = {
	monaco: {
		url: "https://download.geofabrik.de/europe/monaco-250101.osm.pbf",
		bbox: {
			bottom: 43.483817,
			top: 43.75293,
			left: 7.408583,
			right: 7.595671,
		},
		geoJsonFeatures: 9_302,
		nodes: 38_995,
		ways: 5_708,
		relations: 308,
		node0: {
			lat: 43.7371175,
			lon: 7.4229093,
			id: 21911883,
		},
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
		geoJsonFeatures: 384_651,
		nodes: 3_915_383,
		ways: 321_330,
		relations: 5_501,
		node0: {
			lat: 42.1982436,
			lon: 18.9656482,
			id: 26860768,
		},
		uniqueStrings: 35744,
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
		geoJsonFeatures: 1_000_000,
		nodes: 23_063_621,
		ways: 2_315_247,
		relations: 39_098,
		primitiveGroups: 3_178,
		node0: {
			lat: 42.9738772,
			lon: 17.021989,
			id: 4_511_653,
		},
		uniqueStrings: 151_777,
	},
	italy: {
		url: "https://download.geofabrik.de/europe/italy-250101.osm.pbf",
		bbox: {
			bottom: 35.07638,
			left: 6.602696,
			right: 19.12499,
			top: 47.100045,
		},
		geoJsonFeatures: 1_000_000,
		nodes: 250_818_620,
		ways: 27_837_987,
		relations: 100_000,
		primitiveGroups: 34_901,
		node0: {
			lat: 41.9033,
			lon: 12.4534,
			id: 1,
		},
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
		geoJsonFeatures: 1_000_000,
		nodes: 43_032_447,
		ways: 4_541_651,
		relations: 44_373,
		node0: {
			lat: 47.64248,
			lon: -122.3196898,
			id: 29445653,
		},
		uniqueStrings: 598_993,
		primitiveGroups: 34_901,
	},
}

export const smallPBFs = [PBFs.monaco]
