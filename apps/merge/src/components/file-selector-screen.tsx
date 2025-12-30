import type { OsmInfo } from "@osmix/core"
import ExtractList from "./extract-list"
import StoredOsmList from "./stored-osm-list"

interface FileSelectorScreenProps {
	title: string
	description: string
	openOsmFile: (file: File | string) => Promise<OsmInfo | null>
	useExample?: () => Promise<void>
}

export default function FileSelectorScreen({
	title,
	description,
	openOsmFile,
	useExample,
}: FileSelectorScreenProps) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-8 p-8 bg-slate-50">
			<div className="text-center">
				<h1 className="text-3xl font-bold mb-2">{title}</h1>
				<p className="text-muted-foreground max-w-md">{description}</p>
			</div>

			<div className="flex flex-col gap-6 w-full max-w-xl">
				<StoredOsmList openOsmFile={openOsmFile} />
				<ExtractList useExample={useExample} />
			</div>
		</div>
	)
}
