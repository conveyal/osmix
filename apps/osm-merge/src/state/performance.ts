import { atom } from "jotai"

export const performanceMeasurementsAtom = atom<PerformanceEntry[]>([])

performanceMeasurementsAtom.onMount = (_setAtom) => {
	const observer = new PerformanceObserver((entries, _observer) => {
		for (const entry of entries.getEntries()) {
			if (entry.entryType === "mark") {
				console.log(`${entry.name}'s startTime: ${entry.startTime}`)
			}
			if (entry.entryType === "measure") {
				console.log(`${entry.name}'s duration: ${entry.duration}`)
			}
		}
	})
	observer.observe({ entryTypes: ["measure", "mark"] })
	return () => {
		observer.disconnect()
	}
}
