import { useLog } from "@/hooks/log"
import { cn } from "@/lib/utils"
import { formatTimestampMs } from "@/utils"

export default function LogContent() {
	const { log } = useLog()
	return (
		<div className="flex flex-col h-full overflow-x-auto overflow-y-auto text-xs gap-1">
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
		</div>
	)
}
