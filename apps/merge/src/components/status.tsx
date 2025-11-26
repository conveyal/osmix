import { cn, Spinner } from "@osmix/ui"
import { useLog } from "../hooks/log"
import { formatTimestampMs } from "../utils"

export default function Status() {
	const { log, activeTasks } = useLog()
	const status = log[log.length - 1]
	if (!status) return null
	return (
		<div
			className="flex flex-row items-center gap-2"
			title={formatTimestampMs(status.timestamp)}
		>
			{activeTasks > 0 ? (
				<Spinner />
			) : (
				<div
					className={cn(
						"h-2 w-2 rounded-full bg-green-500",
						status.type === "error" && "bg-red-500",
					)}
				/>
			)}
			<div className="text-slate-950">{status.message}</div>
		</div>
	)
}
