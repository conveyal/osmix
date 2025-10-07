import { FilesIcon, XIcon } from "lucide-react"
import { useRef, useTransition } from "react"
import ActionButton from "./action-button"
import { ButtonGroup } from "./ui/button-group"

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
			<ActionButton
				className="flex-1"
				disabled={disabled}
				onAction={async () => fileInputRef.current?.click()}
				icon={<FilesIcon />}
			>
				Select new OSM PBF file
			</ActionButton>
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
			<ActionButton
				disabled={disabled || isTransitioning}
				onAction={async () => setFile(null)}
				title="Clear file"
				icon={<XIcon />}
			/>
		</ButtonGroup>
	)
}
