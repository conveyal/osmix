import { FilesIcon, XIcon } from "lucide-react"
import { useRef, useTransition } from "react"
import { Button } from "./ui/button"
import { ButtonGroup } from "./ui/button-group"
import { Spinner } from "./ui/spinner"

function isOsmPbfFile(file: File | undefined): file is File {
	if (file == null) return false
	if (!file.name.endsWith(".pbf")) return false
	return true
}

export default function OsmPbfFileInput({
	disabled,
	setFile,
	testId,
}: {
	disabled?: boolean
	setFile: (file: File | null) => Promise<void>
	testId?: string
}) {
	const [isTransitioning, startTransition] = useTransition()
	const fileInputRef = useRef<HTMLInputElement>(null)
	return (
		<ButtonGroup className="w-full" data-testid={testId}>
			<Button
				className="flex-1"
				disabled={disabled || isTransitioning}
				onClick={() => fileInputRef.current?.click()}
			>
				{isTransitioning ? <Spinner /> : <FilesIcon />} Select new OSM PBF file
			</Button>
			<input
				disabled={disabled || isTransitioning}
				className="hidden"
				type="file"
				accept=".pbf"
				data-testid={testId ? `${testId}-input` : undefined}
				onChange={(e) => {
					const file = e.target.files?.[0]
					setFile(null)
					if (isOsmPbfFile(file)) {
						startTransition(() => setFile(file))
					}
				}}
				ref={fileInputRef}
			/>
			<Button
				disabled={disabled || isTransitioning}
				onClick={() => startTransition(() => setFile(null))}
				title="Clear file"
			>
				<XIcon />
			</Button>
		</ButtonGroup>
	)
}
