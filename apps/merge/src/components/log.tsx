import { useLog } from "@/hooks/log"
import { cn } from "@/lib/utils"
import { formatTimestampMs } from "@/utils"

export default function LogContent() {
	const { log } = useLog()
	return (
		<>
			{log.toReversed().map((message, index) => (
				<div
					key={`${index}-${message.timestamp}`}
					className={cn(
						"whitespace-nowrap",
						"text-slate-600",
						index === 0 && "text-slate-900 font-medium",
					)}
					title={formatTimestampMs(message.timestamp)}
				>
					[{(message.duration / 1_000).toFixed(3)}s] {message.message}
				</div>
			))}
		</>
	)
}
