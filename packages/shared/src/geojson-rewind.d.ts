declare module "@mapbox/geojson-rewind" {
	import type { Feature } from "geojson"
	function rewind<T extends Feature>(
		feature: T,
		outer: boolean,
	): T
	export default rewind
}

