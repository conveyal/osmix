import { useAtom, useAtomValue } from "jotai"
import { fileAtomFamily, osmAtomFamily, workflowStepAtom } from "@/atoms"
import OsmInfoTable from "./osm-info-table"
import OsmPbfFileInput from "./osm-pbf-file-input"
import FitBounds from "./fit-bounds"

export default function OsmPbfFilePicker({
	category,
}: {
	category: "base" | "patch"
}) {
	const workflowStep = useAtomValue(workflowStepAtom)
	const [file, setFile] = useAtom(fileAtomFamily(category))
	const osm = useAtomValue(osmAtomFamily(category))
	return (
		<div className="flex flex-col gap-1">
			<div className="flex flex-row justify-between items-center">
				<h3>
					{category}: {file?.name}
				</h3>
				<div>
					<FitBounds bounds={osm?.bbox()} />
				</div>
			</div>
			{workflowStep === "select-files" && (
				<OsmPbfFileInput file={file} setFile={setFile} />
			)}
			<OsmInfoTable osm={osm} file={file} />
		</div>
	)
}
