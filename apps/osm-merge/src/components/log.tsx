import { logAtom } from "@/state/log"
import { formatTimestampMs } from "@/utils"
import { useAtomValue } from "jotai"

export default function LogContent() {
	const log = useAtomValue(logAtom)
	return (
		<div className="flex flex-col h-full overflow-x-auto overflow-y-auto text-xs">
			{log.toReversed().map((message, index) => (
				<div
					key={`${index}-${message.timestamp}`}
					className="whitespace-nowrap"
					title={formatTimestampMs(message.timestamp)}
				>
					[{(message.duration / 1_000).toFixed(3)}s] {message.message}
				</div>
			))}
		</div>
	)
}
