import { osmAtomFamily, osmFileAtomFamily } from "@/state/osm"
import { osmWorker } from "@/state/worker"
import * as Comlink from "comlink"
import { useAtom, useAtomValue } from "jotai"
import { Osm } from "osm.ts"
import { useEffect, useMemo, useState } from "react"
import useStartTaskLog from "./log"
import { useFitBoundsOnChange } from "./map"

export function useOsm(id: string) {
	const osm = useAtomValue(osmAtomFamily(id))
	return osm
}

export function useOsmFile(id: string, defaultFilePath?: string) {
	const [file, setFile] = useAtom(osmFileAtomFamily(id))
	const [osm, setOsm] = useAtom(osmAtomFamily(id))
	const [isLoading, setIsLoading] = useState(false)
	const startTaskLog = useStartTaskLog()
	const bbox = useMemo(() => osm?.bbox(), [osm])

	useFitBoundsOnChange(bbox)

	const [loadOnStart, setLoadOnStart] = useState(
		process.env.NODE_ENV === "development",
	)
	useEffect(() => {
		if (!loadOnStart || !defaultFilePath) return
		setLoadOnStart(false)
		console.error("LOADING DEFAULT FILE", defaultFilePath)
		fetch(defaultFilePath)
			.then((res) => res.blob())
			.then((blob) => {
				setFile(new File([blob], defaultFilePath))
			})
	}, [defaultFilePath, setFile, loadOnStart])

	useEffect(() => {
		setOsm(null)
		if (!file) return
		const taskLog = startTaskLog(`Processing file ${file.name}...`)
		const stream = file.stream()
		setIsLoading(true)
		osmWorker
			.initFromPbfData(id ?? file.name, Comlink.transfer(stream, [stream]))
			.then(async (osmBuffers) => {
				setOsm(Osm.from(osmBuffers))
				taskLog.end(`${file.name} fully loaded.`)
			})
			.catch((e) => {
				console.error(e)
				taskLog.end(`${file.name} failed to load.`, "error")
			})
			.finally(() => {
				setIsLoading(false)
			})
	}, [file, id, setOsm, startTaskLog])

	return { file, setFile, osm, setOsm, isLoading }
}
