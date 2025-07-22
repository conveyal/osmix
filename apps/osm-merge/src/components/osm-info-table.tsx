import type { Osm } from "osm.ts"
import ObjectToTable from "../object-to-table"

export default function OsmInfoTable({ osm }: { osm: Osm | null }) {
	if (!osm) return null
	return (
		<details>
			<summary>Osm Info</summary>
			<table>
				<ObjectToTable object={osm.header} />
				<tbody>
					<tr>
						<td>ways</td>
						<td>{osm.ways.size.toLocaleString()}</td>
					</tr>
					<tr>
						<td>nodes</td>
						<td>{osm.nodes.size.toLocaleString()}</td>
					</tr>
					<tr>
						<td>relations</td>
						<td>{osm.relations.size.toLocaleString()}</td>
					</tr>
				</tbody>
			</table>
		</details>
	)
}
