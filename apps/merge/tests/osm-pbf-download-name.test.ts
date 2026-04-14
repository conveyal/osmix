import { describe, expect, it } from "bun:test"
import { ensureOsmPbfDownloadName } from "../src/lib/osm-pbf-download-name"

describe("ensureOsmPbfDownloadName", () => {
	it("replaces other extensions with .pbf", () => {
		expect(ensureOsmPbfDownloadName("foo.geojson")).toBe("foo.pbf")
		expect(ensureOsmPbfDownloadName("osmix-bar.json")).toBe("osmix-bar.pbf")
	})

	it("appends .pbf when no extension exists", () => {
		expect(ensureOsmPbfDownloadName("baz")).toBe("baz.pbf")
	})

	it("preserves existing .pbf names (case-insensitive)", () => {
		expect(ensureOsmPbfDownloadName("qux.pbf")).toBe("qux.pbf")
		expect(ensureOsmPbfDownloadName("QuX.PBF")).toBe("QuX.PBF")
		expect(ensureOsmPbfDownloadName("already.osm.pbf")).toBe("already.osm.pbf")
	})
})
