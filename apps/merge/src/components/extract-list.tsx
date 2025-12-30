import { FilesIcon } from "lucide-react"
import type { OsmInfo } from "osmix"
import { useEffectEvent } from "react"
import { fetchOsmFileFromUrl } from "../lib/fetch-osm-file"
import { Log } from "../state/log"
import ActionButton from "./action-button"
import { Card, CardContent } from "./ui/card"

const EXAMPLE_MONACO_PBF_URL =
	"https://trevorgerhardt.github.io/files/487218b69358-1f24d3e4e476/monaco.pbf"

export default function ExtractList({
	openOsmFile,
}: {
	openOsmFile: (file: File) => Promise<OsmInfo | null>
}) {
	const useExample = useEffectEvent(async () => {
		const task = Log.startTask("Downloading Monaco.pbf example...")
		try {
			const exampleFile = await fetchOsmFileFromUrl(EXAMPLE_MONACO_PBF_URL)
			task.update("Opening file...")
			const osmInfo = await openOsmFile(exampleFile)
			task.end("Example loaded")
			return osmInfo
		} catch (e) {
			const message = e instanceof Error ? e.message : "Unknown error"
			task.end(`Failed to load example: ${message}`, "error")
			throw e
		}
	})

	return (
		<Card>
			<CardContent className="flex flex-col gap-2 leading-relaxed p-4">
				<p>
					Looking for OpenStreetMap PBF data? We recommend the following
					services:
				</p>
				<ul className="list-disc list-inside space-y-1">
					<li>
						<a
							href="https://slice.openstreetmap.us/#0/0/0"
							target="_blank"
							rel="noreferrer"
							className="text-blue-500"
						>
							SliceOSM
						</a>
						: Create a slice for any custom bounding box, GeoJSON polygon or
						multipolygon area.
					</li>
					<li>
						<a
							href="https://download.geofabrik.de"
							target="_blank"
							rel="noreferrer"
							className="text-blue-500"
						>
							Geofabrik Extracts
						</a>
						: Extracts for the world, continents, countries, regions--updated
						daily.
					</li>
				</ul>
				<ActionButton
					className="w-full"
					icon={<FilesIcon />}
					onAction={useExample}
				>
					Use example Monaco.pbf file
				</ActionButton>
			</CardContent>
		</Card>
	)
}
