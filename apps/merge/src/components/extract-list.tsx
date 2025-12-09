import { Card, CardContent } from "./ui/card"

export default function ExtractList() {
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
			</CardContent>
		</Card>
	)
}
