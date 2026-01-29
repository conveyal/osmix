import type { OsmInfo } from "@osmix/core"
import type { OsmFileType } from "osmix"
import { BASE_OSM_KEY } from "../settings"
import ExtractList from "./extract-list"
import StoredOsmList from "./stored-osm-list"

interface FileSelectorScreenProps {
	openOsmFile: (
		file: File | string,
		fileType?: OsmFileType,
	) => Promise<OsmInfo | null>
}

export default function FileSelectorScreen({
	openOsmFile,
}: FileSelectorScreenProps) {
	return (
		<div className="bg-slate-50 overflow-y-scroll w-full h-full">
			<div className="flex flex-col gap-8 max-w-xl py-20 my-auto mx-auto">
				<div className="text-center font-bold uppercase text-2xl">OSMIX</div>
				<p className="text-center text-muted-foreground ">
					Select an OSM file to get started.
				</p>

				<ExtractList openOsmFile={openOsmFile} />

				<StoredOsmList osmKey={BASE_OSM_KEY} openOsmFile={openOsmFile} />
			</div>
		</div>
	)
}
