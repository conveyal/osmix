import { SearchIcon } from "lucide-react"
import { useState, useTransition } from "react"
import type { MapInstance } from "react-map-gl/maplibre"
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "../components/ui/input-group"
import { cn } from "../lib/utils"
import { Spinner } from "./ui/spinner"

type NominatimResult = {
	addresstype: string
	address: Record<string, string>
	place_id: number
	display_name: string
	boundingbox?: [string, string, string, string]
	lat: string
	lon: string
	type?: string
} & Record<string, unknown>

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search"

export default function NominatimSearchControl({ map }: { map?: MapInstance }) {
	const [query, setQuery] = useState("")
	const [results, setResults] = useState<NominatimResult[]>([])
	const [error, setError] = useState<string | null>(null)
	const [isTransitioning, startTransition] = useTransition()

	const search = (value: string) => {
		setError(null)
		setResults([])
		const trimmed = value.trim()
		if (!trimmed) return
		startTransition(async () => {
			try {
				const url = new URL(NOMINATIM_ENDPOINT)
				url.searchParams.set("format", "jsonv2")
				url.searchParams.set("limit", "10")
				url.searchParams.set("q", trimmed)
				const bounds = map?.getBounds()
				if (bounds)
					url.searchParams.set("viewbox", bounds.toArray().flat().join(","))

				const response = await fetch(url.toString(), {
					headers: {
						Accept: "application/json",
					},
				})
				if (!response.ok) {
					throw Error(`Nominatim request failed (${response.status})`)
				}

				const data = (await response.json()) as NominatimResult[]
				setResults(Array.isArray(data) ? data : [])
			} catch (err) {
				console.error(err)
				setError("Unable to load results")
				setResults([])
			}
		})
	}

	const handleSelect = (result: NominatimResult) => {
		setQuery(result.display_name)
		setResults([])

		if (!map) return

		const bbox = result.boundingbox?.map(Number)
		if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) {
			const [latSouth, latNorth, lonWest, lonEast] = bbox as [
				number,
				number,
				number,
				number,
			]
			// Clamp to a sensible padding so we don't zoom too far out
			map.fitBounds(
				[
					[lonWest, latSouth],
					[lonEast, latNorth],
				],
				{ padding: 100, maxDuration: 100 },
			)
			return
		}

		const lat = Number(result.lat)
		const lon = Number(result.lon)
		if (Number.isFinite(lat) && Number.isFinite(lon)) {
			const currentZoom = map.getZoom?.() ?? 12
			const targetZoom = Math.max(currentZoom, 14)
			map.flyTo({
				center: [lon, lat],
				zoom: targetZoom,
				maxDuration: 100,
			})
		}
	}

	return (
		<div className="bg-background w-sm max-w-sm shadow rounded">
			<form
				onSubmit={(e) => {
					e.preventDefault()
					search(query)
				}}
			>
				<InputGroup>
					<InputGroupInput
						onFocus={(e) => e.target.select()}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search for a place"
						aria-label="Search for a place"
					/>
					<InputGroupAddon align="inline-end">
						<InputGroupButton
							type="submit"
							size="icon-sm"
							title="Search"
							variant="ghost"
							disabled={isTransitioning}
						>
							{isTransitioning ? (
								<Spinner />
							) : (
								<SearchIcon className="size-4" />
							)}
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
			</form>

			{error ? (
				<div className="px-3 py-2 text-destructive">{error}</div>
			) : isTransitioning ? (
				<div className="px-3 py-2 text-muted-foreground">Searching...</div>
			) : null}

			{results.length > 0 && (
				<div className="max-h-60 overflow-y-auto rounded">
					<ul className="divide-y">
						{results.map((result) => (
							<li key={result.place_id}>
								<button
									type="button"
									className={cn(
										"w-full px-3 py-2 text-left cursor-pointer",
										"hover:bg-accent hover:text-accent-foreground",
									)}
									onClick={() => handleSelect(result)}
								>
									<div className="font-bold leading-4">
										{result.display_name}
									</div>
								</button>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	)
}
