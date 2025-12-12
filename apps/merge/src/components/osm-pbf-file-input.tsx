import { FilesIcon, XIcon } from "lucide-react"
import ActionButton from "./action-button"

function isOsmFile(file: File | null): file is File {
	if (file == null) return false
	const name = file.name.toLowerCase()
	return (
		name.endsWith(".pbf") || name.endsWith(".geojson") || name.endsWith(".json")
	)
}

export default function OsmPbfFileInput({
	disabled,
	file,
	setFile,
}: {
	disabled?: boolean
	file?: File | null
	setFile: (file: File | null) => Promise<void>
}) {
	return !file ? (
		<OsmPbfSelectFileButton disabled={disabled} setFile={setFile} />
	) : (
		<OsmPbfClearFileButton
			disabled={disabled}
			clearFile={() => setFile(null)}
		/>
	)
}

export function OsmPbfSelectFileButton({
	disabled,
	setFile,
}: {
	disabled?: boolean
	setFile: (file: File | null) => Promise<void>
}) {
	return (
		<ActionButton
			className="w-full"
			disabled={disabled}
			onAction={async () => {
				const selectedFile = await showFileSelector()
				if (isOsmFile(selectedFile)) {
					await setFile(selectedFile)
				}
			}}
			icon={<FilesIcon />}
		>
			Select OSM PBF or GeoJSON
		</ActionButton>
	)
}

export function OsmPbfClearFileButton({
	disabled,
	clearFile,
}: {
	disabled?: boolean
	clearFile: () => Promise<void>
}) {
	return (
		<ActionButton
			disabled={disabled}
			onAction={clearFile}
			title="Clear file"
			icon={<XIcon />}
			size="icon-sm"
			variant="ghost"
		/>
	)
}

function showFileSelector() {
	const input = document.createElement("input")
	input.type = "file"
	input.accept = ".pbf,.geojson,.json"

	return new Promise<File | null>((resolve) => {
		const focusListener = () => {
			setTimeout(() => {
				resolve(null)
				removeListener()
			}, 300)
		}
		const removeListener = () =>
			window.removeEventListener("focus", focusListener)
		input.onchange = () => {
			if (input.files !== null) {
				resolve(input.files[0])
				removeListener()
			} else {
				resolve(null)
				removeListener()
			}
		}

		window.addEventListener("focus", focusListener)
		input.click()
	})
}
