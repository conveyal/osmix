import { FilesIcon, LinkIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { fetchOsmFileFromUrl } from "../lib/fetch-osm-file"
import { Log } from "../state/log"
import ActionButton from "./action-button"
import { Button } from "./ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./ui/dialog"
import { Input } from "./ui/input"

function isOsmFile(file: File | null): file is File {
	if (file == null) return false
	const name = file.name.toLowerCase()
	return (
		name.endsWith(".pbf") ||
		name.endsWith(".geojson") ||
		name.endsWith(".json") ||
		name.endsWith(".zip")
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
			Open OSM file (PBF, GeoJSON, or Shapefile)
		</ActionButton>
	)
}

export function OsmPbfOpenUrlButton({
	disabled,
	setFile,
}: {
	disabled?: boolean
	setFile: (file: File | null) => Promise<void>
}) {
	const [open, setOpen] = useState(false)
	const [url, setUrl] = useState("")

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button className="w-full" variant="outline" disabled={disabled}>
					<LinkIcon />
					Open from URL
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Open OSM from URL</DialogTitle>
					<DialogDescription>
						Provide a direct link to a <code>.pbf</code>, <code>.geojson</code>,
						<code>.json</code>, or <code>.zip</code> (Shapefile) file. The
						server must allow browser downloads (CORS).
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-2">
					<Input
						placeholder="https://example.com/data.osm.pbf"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						autoFocus
					/>
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => setOpen(false)}
					>
						Cancel
					</Button>
					<ActionButton
						disabled={disabled || url.trim().length === 0}
						icon={<LinkIcon />}
						onAction={async () => {
							const task = Log.startTask("Downloading file from URL...")
							try {
								const file = await fetchOsmFileFromUrl(url)
								task.end(`Downloaded ${file.name}`)
								await setFile(file)
								setOpen(false)
							} catch (e) {
								const message = e instanceof Error ? e.message : "Unknown error"
								task.end(`Download failed: ${message}`, "error")
								throw e
							}
						}}
					>
						Download and open
					</ActionButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
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
	input.accept = ".pbf,.geojson,.json,.zip"

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
