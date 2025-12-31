import type { Osm } from "@osmix/core"
import { bytesSizeToHuman } from "../utils"
import type { StoredFileInfo } from "../workers/osm.worker"
import { Details, DetailsContent, DetailsSummary } from "./details"
import ObjectToTableRows from "./object-to-table"

export default function OsmInfoTable({
	defaultOpen,
	osm,
	file,
	fileInfo,
}: {
	defaultOpen?: boolean
	osm: Osm | null
	file?: File | null
	/** Alternative to file - used when loading from storage */
	fileInfo?: StoredFileInfo | null
}) {
	// Get file name and size from either file or fileInfo
	const fileSize = file?.size ?? fileInfo?.fileSize

	if (!osm || (!file && !fileInfo)) return null
	return (
		<Details defaultOpen={defaultOpen}>
			<DetailsSummary>FILE INFO</DetailsSummary>
			<DetailsContent className="overflow-auto">
				<table>
					<tbody>
						{fileSize != null && (
							<tr>
								<td>size</td>
								<td>{bytesSizeToHuman(fileSize)}</td>
							</tr>
						)}
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
