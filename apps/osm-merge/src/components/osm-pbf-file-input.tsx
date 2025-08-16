import { useRef } from "react"
import { Button } from "./ui/button"
import { FilesIcon, Loader2Icon, LoaderIcon } from "lucide-react"

function isOsmPbfFile(file: File | undefined): file is File {
	if (file == null) return false
	if (!file.name.endsWith(".pbf")) return false
	return true
}

export default function OsmPbfFileInput({
	disabled,
	isLoading,
	file,
	setFile,
}: {
	disabled?: boolean
	isLoading?: boolean
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
				disabled={disabled || isLoading}
				size="lg"
				type="button"
				onClick={() => fileInputRef.current?.click()}
				variant="default"
			>
				{file && isLoading ? (
					<>
						<Loader2Icon className="animate-spin" /> Loading {file.name}...
					</>
				) : (
					<>
						<FilesIcon />
						Select OSM PBF file
					</>
				)}
			</Button>
		</label>
	)
}
