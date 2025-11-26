import type { Osm } from "@osmix/core"
import { bytesSizeToHuman } from "../utils"
import { Details, DetailsContent, DetailsSummary } from "./details"
import ObjectToTableRows from "./object-to-table"

export default function OsmInfoTable({
	defaultOpen,
	osm,
	file,
}: {
	defaultOpen?: boolean
	osm: Osm | null
	file: File | null
}) {
	if (!osm || !file) return null
	return (
		<Details open={defaultOpen}>
			<DetailsSummary>FILE: {file.name}</DetailsSummary>
			<DetailsContent className="overflow-auto">
				<table>
					<tbody>
						<tr>
							<td>size</td>
							<td>{bytesSizeToHuman(file.size)}</td>
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
							<td className="font-bold">HEADER</td>
							<td />
						</tr>
						<ObjectToTableRows object={osm.header} />
					</tbody>
				</table>
			</DetailsContent>
		</Details>
	)
}
