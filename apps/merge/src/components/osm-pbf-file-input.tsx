import { Menu } from "@base-ui/react/menu"
import { ChevronDownIcon, FilesIcon, LinkIcon, XIcon } from "lucide-react"
import type { OsmFileType } from "osmix"
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

/** File type options with labels and accepted extensions */
const FILE_TYPE_OPTIONS: {
	type: OsmFileType
	label: string
	description: string
	accept: string
}[] = [
	{
		type: "pbf",
		label: "OSM PBF",
		description: "OpenStreetMap Protocol Buffer format",
		accept: ".pbf,.osm.pbf",
	},
	{
		type: "geojson",
		label: "GeoJSON",
		description: "GeoJSON feature collection",
		accept: ".geojson,.json",
	},
	{
		type: "shapefile",
		label: "Shapefile (ZIP)",
		description: "ESRI Shapefile in ZIP archive",
		accept: ".zip",
	},
	{
		type: "geoparquet",
		label: "GeoParquet",
		description: "Apache Parquet with geometry",
		accept: ".parquet",
	},
]

export default function OsmPbfFileInput({
	disabled,
	file,
	setFile,
}: {
	disabled?: boolean
	file?: File | null
	setFile: (file: File | null, fileType?: OsmFileType) => Promise<void>
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
	setFile: (file: File | null, fileType?: OsmFileType) => Promise<void>
}) {
	const [isLoading, setIsLoading] = useState(false)

	const handleSelectFileType = async (fileType: OsmFileType) => {
		const option = FILE_TYPE_OPTIONS.find((opt) => opt.type === fileType)
		if (!option) return

		setIsLoading(true)
		try {
			const selectedFile = await showFileSelector(option.accept)
			if (selectedFile) {
				await setFile(selectedFile, fileType)
			}
		} finally {
			setIsLoading(false)
		}
	}

	return (
		<Menu.Root>
			<Menu.Trigger
				disabled={disabled || isLoading}
				className="cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 has-[>svg]:px-3 flex-1"
			>
				<FilesIcon />
				Open file
				<ChevronDownIcon className="ml-auto" />
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner className="z-50" sideOffset={4}>
					<Menu.Popup className="min-w-[200px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95">
						{FILE_TYPE_OPTIONS.map((option) => (
							<Menu.Item
								key={option.type}
								className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
								onClick={() => handleSelectFileType(option.type)}
							>
								<div className="flex flex-col gap-0.5">
									<span className="font-medium">{option.label}</span>
									<span className="text-muted-foreground">
										{option.description}
									</span>
								</div>
							</Menu.Item>
						))}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	)
}

export function OsmPbfOpenUrlButton({
	disabled,
	setFile,
}: {
	disabled?: boolean
	setFile: (file: File | null, fileType?: OsmFileType) => Promise<void>
}) {
	const [open, setOpen] = useState(false)
	const [url, setUrl] = useState("")
	const [selectedFileType, setSelectedFileType] = useState<OsmFileType>("pbf")

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button className="flex-1" variant="outline" disabled={disabled}>
					<LinkIcon />
					Open from URL
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Open OSM from URL</DialogTitle>
					<DialogDescription>
						Provide a direct link and select the file type. The server must
						allow browser downloads (CORS).
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<div className="font-medium">File Type</div>
						<Menu.Root>
							<Menu.Trigger className="cursor-pointer inline-flex items-center justify-between gap-2 whitespace-nowrap rounded-md font-medium border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground h-9 px-3 py-2 w-full">
								{FILE_TYPE_OPTIONS.find((o) => o.type === selectedFileType)
									?.label ?? "Select file type"}
								<ChevronDownIcon />
							</Menu.Trigger>
							<Menu.Portal>
								<Menu.Positioner className="z-50" sideOffset={4}>
									<Menu.Popup className="min-w-[200px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95">
										{FILE_TYPE_OPTIONS.map((option) => (
											<Menu.Item
												key={option.type}
												className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
												onClick={() => setSelectedFileType(option.type)}
											>
												<div className="flex flex-col gap-0.5">
													<span className="font-medium">{option.label}</span>
													<span className="text-muted-foreground">
														{option.description}
													</span>
												</div>
											</Menu.Item>
										))}
									</Menu.Popup>
								</Menu.Positioner>
							</Menu.Portal>
						</Menu.Root>
					</div>

					<div className="flex flex-col gap-2">
						<label htmlFor="url-input" className="font-medium">
							URL
						</label>
						<Input
							id="url-input"
							placeholder="https://example.com/data.osm.pbf"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							autoFocus
						/>
					</div>
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
								await setFile(file, selectedFileType)
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

function showFileSelector(accept: string) {
	const input = document.createElement("input")
	input.type = "file"
	input.accept = accept

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
