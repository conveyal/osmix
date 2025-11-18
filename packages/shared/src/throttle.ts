export function throttle<T extends unknown[]>(
	func: (...args: T) => void,
	timeFrame: number,
) {
	let lastTime = 0
	return (...args: T) => {
		const now = Date.now()
		if (now - lastTime >= timeFrame) {
			func(...args)
			lastTime = now
		}
	}
}
