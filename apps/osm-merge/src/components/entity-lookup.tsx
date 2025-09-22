import type { OsmEntity } from "osm.ts"
import { useActionState } from "react"
import { Button } from "./ui/button"
import { SearchIcon } from "lucide-react"

export default function EntityLookup({
	setSelectedEntity,
}: {
	setSelectedEntity: (id: string) => OsmEntity | null
}) {
	const [, formAction] = useActionState<OsmEntity | null, FormData>(
		(_state, formData) => {
			const fde = formData.get("entityId")
			if (!fde) return null
			return setSelectedEntity(fde.toString())
		},
		null,
	)
	return (
		<form action={formAction} className="flex flex-row border-1">
			<input
				type="text"
				name="entityId"
				placeholder={`Find entity by ID (prefix "n", "w", or "r")`}
				className="w-full border-none pl-2"
			/>
			<Button type="submit" variant="ghost">
				<SearchIcon />
			</Button>
		</form>
	)
}
