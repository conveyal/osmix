import { useRef } from "react"
import { Button } from "./ui/button"
import { useAtom, useAtomValue } from "jotai"
import { fileAtomFamily, osmAtomFamily, workflowStepAtom } from "@/atoms"
import { MaximizeIcon } from "lucide-react"
import OsmInfoTable from "./osm-info-table"
import { mapAtom } from "@/state/map"

function isOsmPbfFile(file: File | undefined): file is File {
	if (file == null) return false
	if (!file.name.endsWith(".pbf")) return false
	return true
}

export default function OsmPbfFilePicker({
	category,
}: {
	category: "base" | "patch"
}) {
	const workflowStep = useAtomValue(workflowStepAtom)
	const [file, setFile] = useAtom(fileAtomFamily(category))
	const osm = useAtomValue(osmAtomFamily(category))
	const map = useAtomValue(mapAtom)
	return (
		<div className="flex flex-col gap-1">
			<div className="flex flex-row justify-between items-center">
				<h3>
					{category}: {file?.name}
				</h3>
				<div>
					<Button
						variant="ghost"
						size="icon"
						title="Fit map to OSM bounds"
						onClick={() => {
							const bbox = osm?.bbox()
							if (!bbox) return
							map?.fitBounds(bbox, {
								padding: 100,
								maxDuration: 200,
							})
						}}
					>
						<MaximizeIcon />
					</Button>
				</div>
			</div>
			{workflowStep === "select-files" && (
				<OsmPbfFileInput file={file} setFile={setFile} />
			)}
			<OsmInfoTable osm={osm} />
		</div>
	)
}

export function OsmPbfFileInput({
	disabled,
	file,
	setFile,
}: {
	disabled?: boolean
	file: File | null
	setFile: (file: File) => void
}) {
	const fileInputRef = useRef<HTMLInputElement>(null)
	return (
		<label
			className="flex flex-col"
			onDragEnter={(e) => e.preventDefault()}
			onDragOver={(e) => e.preventDefault()}
			onDrop={(e) => {
				e.preventDefault()
				const file = e.dataTransfer.files[0]
				if (isOsmPbfFile(file)) {
					setFile(file)
				}
			}}
		>
			<input
				disabled={disabled}
				className="hidden"
				type="file"
				accept=".pbf"
				onChange={(e) => {
					const file = e.target.files?.[0]
					if (isOsmPbfFile(file)) {
						setFile(file)
					}
				}}
				ref={fileInputRef}
			/>
			<Button
				disabled={disabled}
				size="sm"
				type="button"
				onClick={() => fileInputRef.current?.click()}
				variant="outline"
			>
				Choose file
			</Button>
		</label>
	)
}

function sizeToHuman(size?: number) {
	if (size == null) return "none"
	if (size < 1024) return `${size}B`
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)}KB`
	if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)}MB`
	return `${(size / 1024 / 1024 / 1024).toFixed(2)}GB`
}
