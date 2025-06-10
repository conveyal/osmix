import { useRef } from "react"
import { Button } from "./ui/button"

function isOsmPbfFile(file: File | undefined): file is File {
	if (file == null) return false
	if (!file.name.endsWith(".pbf")) return false
	return true
}

export default function OsmPbfFilePicker({
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
