import { useAtom, useSetAtom } from "jotai"
import { MergeIcon } from "lucide-react"
import { Suspense, useMemo } from "react"
import ActionButton from "../components/action-button"
import { Details, DetailsContent, DetailsSummary } from "../components/details"
import ChangesSummary, {
	ChangesFilters,
	ChangesList,
	ChangesPagination,
} from "../components/osm-changes-summary"
import { Card, CardContent, CardHeader } from "../components/ui/card"
import { useFlyToEntity } from "../hooks/map"
import { useOsmFile } from "../hooks/osm"
import { BASE_OSM_KEY } from "../settings"
import { changesetStatsAtom } from "../state/changes"
import { Log } from "../state/log"
import { selectOsmEntityAtom } from "../state/osm"
import { osmWorker } from "../state/worker"

export default function InspectBlock() {
	const flyToEntity = useFlyToEntity()
	const baseOsm = useOsmFile(BASE_OSM_KEY)
	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const [changesetStats, setChangesetStats] = useAtom(changesetStatsAtom)

	const applyChanges = async () => {
		if (!baseOsm.osm) throw Error("Osm has not been loaded.")
		const task = Log.startTask("Applying changes to OSM...")
		await osmWorker.applyChangesAndReplace(baseOsm.osm.id)
		task.update("Refreshing OSM index...")
		const newOsm = await osmWorker.get(baseOsm.osm.id)
		baseOsm.setOsm(newOsm)
		setChangesetStats(null)
		task.end("Changes applied!")
	}

	const hasZeroChanges = useMemo(() => {
		return changesetStats == null || changesetStats.totalChanges === 0
	}, [changesetStats])

	// Show full-screen file selector when no file is selected
	if (!baseOsm.osm || !baseOsm.osmInfo || !baseOsm.fileInfo) return null

	return (
		<div className="flex flex-1 flex-col gap-4">
			<ActionButton
				onAction={async () => {
					if (!baseOsm.osm) throw Error("Osm has not been loaded.")
					const changes = await osmWorker.generateChangeset(
						baseOsm.osm.id,
						baseOsm.osm.id,
						{
							deduplicateNodes: true,
							deduplicateWays: true,
						},
					)
					setChangesetStats(changes)
				}}
			>
				Find duplicate nodes and ways
			</ActionButton>

			{changesetStats != null && (
				<>
					<Card>
						<CardHeader className="p-2">Changeset</CardHeader>
						<CardContent>
							<ChangesSummary />
							<Suspense fallback={<div className="py-1 px-2">LOADING...</div>}>
								<Details>
									<DetailsSummary>CHANGES</DetailsSummary>
									<DetailsContent>
										<ChangesFilters />
										<ChangesList
											setSelectedEntity={(entity) => {
												if (!baseOsm.osm)
													throw Error("Osm has not been loaded.")
												selectEntity(baseOsm.osm, entity)
												flyToEntity(baseOsm.osm, entity)
											}}
										/>
										<ChangesPagination />
									</DetailsContent>
								</Details>
							</Suspense>
						</CardContent>
					</Card>

					{!hasZeroChanges && (
						<ActionButton
							className="w-full"
							onAction={applyChanges}
							icon={<MergeIcon />}
						>
							Apply changes
						</ActionButton>
					)}
				</>
			)}
		</div>
	)
}
