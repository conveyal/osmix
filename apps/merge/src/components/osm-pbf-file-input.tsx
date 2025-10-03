import { FilesIcon, Loader2Icon, XIcon } from "lucide-react"
import { useRef } from "react"
import { Button } from "./ui/button"

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
	setFile: (file: File | null) => void
}) {
	const fileInputRef = useRef<HTMLInputElement>(null)
	return (
		<label
			className="flex"
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
				className="flex-1"
				disabled={disabled || isLoading}
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
						Select new OSM PBF file
					</>
				)}
			</Button>
			<Button
				disabled={disabled || isLoading}
				onClick={() => setFile(null)}
				title="Clear file"
			>
				<XIcon />
			</Button>
		</label>
	)
}
