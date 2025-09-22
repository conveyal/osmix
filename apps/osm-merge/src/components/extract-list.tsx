export default function ExtractList() {
	return (
		<>
			<div>
				Looking for OpenStreetMap PBF data? We recommend the following services:
			</div>
			<ul className="list-disc list-inside space-y-1">
				<li>
					<a
						href="https://slice.openstreetmap.us/#0/0/0"
						target="_blank"
						rel="noreferrer"
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
					>
						Geofabrik Extracts
					</a>
					: Extracts for the world, continents, countries, regions--updated
					daily.
				</li>
			</ul>
		</>
	)
}
