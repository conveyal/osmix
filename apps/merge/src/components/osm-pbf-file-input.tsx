import { FilesIcon, XIcon } from "lucide-react"
import ActionButton from "./action-button"
import { ButtonGroup, ButtonGroupSeparator } from "./ui/button-group"

function isOsmFile(file: File | null): file is File {
	if (file == null) return false
	const name = file.name.toLowerCase()
	return (
		name.endsWith(".pbf") ||
		name.endsWith(".geojson") ||
		name.endsWith(".json")
	)
}

export default function OsmPbfFileInput({
	disabled,
	file,
	setFile,
	testId,
}: {
	disabled?: boolean
	file?: File | null
	setFile: (file: File | null) => Promise<void>
	testId?: string
}) {
	return (
		<ButtonGroup className="w-full" data-testid={testId}>
			<ActionButton
				className="flex-1"
				disabled={disabled}
				onAction={async () => {
					const selectedFile = await showFileSelector()
					if (isOsmFile(selectedFile)) {
						await setFile(selectedFile)
					}
				}}
				icon={<FilesIcon />}
			>
				Select OSM PBF or GeoJSON file
			</ActionButton>
			<ButtonGroupSeparator />
			<ActionButton
				disabled={disabled || !file}
				onAction={() => setFile(null)}
				title="Clear file"
				icon={<XIcon />}
			/>
		</ButtonGroup>
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
