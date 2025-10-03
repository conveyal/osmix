import { FilesIcon, Loader2Icon, XIcon } from "lucide-react"
import { useRef, useTransition } from "react"
import { Button } from "./ui/button"

function isOsmPbfFile(file: File | undefined): file is File {
	if (file == null) return false
	if (!file.name.endsWith(".pbf")) return false
	return true
}

export default function OsmPbfFileInput({
	disabled,
	file,
	setFile,
}: {
	disabled?: boolean
	file: File | null
	setFile: (file: File | null) => Promise<void>
}) {
	const [isTransitioning, startTransition] = useTransition()
	const fileInputRef = useRef<HTMLInputElement>(null)
	return (
		<label className="flex">
			<input
				disabled={disabled || isTransitioning}
				className="hidden"
				type="file"
				accept=".pbf"
				onChange={(e) => {
					const file = e.target.files?.[0]
					if (isOsmPbfFile(file)) {
						startTransition(() => setFile(file))
					}
				}}
				ref={fileInputRef}
			/>
			<Button
				className="flex-1"
				disabled={disabled || isTransitioning}
				type="button"
				onClick={() => fileInputRef.current?.click()}
				variant="default"
			>
				{file && isTransitioning ? (
					<>
						<Loader2Icon className="animate-spin" /> Loading {file.name}...
					</>
				) : (
					<>
						<FilesIcon />
						Select new OSM PBF file
					</>
				)}
			</Button>
			<Button
				disabled={disabled || isTransitioning}
				onClick={() => startTransition(() => setFile(null))}
				title="Clear file"
			>
				<XIcon />
			</Button>
		</label>
	)
}
