export const PERF_PREFIX = "osmix"

export function mark(name: string, detail?: Record<string, unknown>) {
	performance.mark(`${PERF_PREFIX}:${name}`, {
		detail,
	})
}

export function measure(
	name: string,
	start: number,
	duration: number,
	detail?: Record<string, unknown>,
) {
	performance.measure(`${PERF_PREFIX}:${name}`, {
		start,
		duration,
		detail,
	})
}

export function createMeasure(name: string) {
	const startTime = performance.now()

	return (detail?: Record<string, unknown>) => {
		measure(name, startTime, performance.now() - startTime, detail)
	}
}
