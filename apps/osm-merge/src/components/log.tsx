import { useAtomValue } from "jotai"
import { logAtom } from "@/state/log"
import { formatTimestampMs } from "@/utils"

export default function LogContent() {
	const log = useAtomValue(logAtom)
	return (
		<div className="flex flex-col h-full overflow-x-auto overflow-y-auto text-xs">
			{log.toReversed().map((message, index) => (
				<div
					key={`${index}-${message.timestamp}`}
					className="whitespace-nowrap"
				>
					{formatTimestampMs(message.timestamp)} &rarr; {message.message}
				</div>
			))}
		</div>
	)
}
