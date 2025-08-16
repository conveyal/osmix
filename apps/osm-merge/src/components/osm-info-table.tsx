import type { Osm } from "osm.ts"
import ObjectToTableRows from "./object-to-table"
import { bytesSizeToHuman } from "@/utils"

export default function OsmInfoTable({
	osm,
	file,
}: { osm: Osm | null; file: File | null }) {
	if (!osm || !file) return null
	return (
		<details open className="border-l border-b border-slate-950">
			<summary className="p-1 font-bold">FILE: {file.name}</summary>
			<div className="overflow-auto">
				<table>
					<tbody>
						<tr>
							<td>size</td>
							<td>{bytesSizeToHuman(file.size)}</td>
						</tr>
						<tr>
							<td>parse time</td>
							<td>{(osm.parsingTimeMs / 1_000).toFixed(3)}</td>
						</tr>
						<tr>
							<td>nodes</td>
							<td>{osm.nodes.size.toLocaleString()}</td>
						</tr>
						<tr>
							<td>ways</td>
							<td>{osm.ways.size.toLocaleString()}</td>
						</tr>
						<tr>
							<td>relations</td>
							<td>{osm.relations.size.toLocaleString()}</td>
						</tr>
						<tr>
							<td>bbox</td>
							<td>{osm.bbox()?.join(",")}</td>
						</tr>
						<tr>
							<td>Header</td>
						</tr>
						<ObjectToTableRows object={osm.header} />
					</tbody>
				</table>
			</div>
		</details>
	)
}
