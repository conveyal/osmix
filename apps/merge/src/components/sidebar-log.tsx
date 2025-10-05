import { useLog } from "@/hooks/log"
import { cn } from "@/lib/utils"
import { formatTimestampMs } from "@/utils"
import LogContent from "./log"
import { Spinner } from "./ui/spinner"

export default function SidebarLog() {
	const { activeTasks, log } = useLog()
	const status = log[log.length - 1]
	return (
		<div className="border-t">
			<div className="flex items-center justify-between px-4 py-2 border-b shadow">
				<span className="font-bold uppercase">Activity Log</span>
				{status && (
					<span
						className="flex items-center gap-2"
						title={formatTimestampMs(status.timestamp)}
					>
						{activeTasks > 0 ? (
							<Spinner />
						) : (
							<span
								className={cn(
									"h-2 w-2 rounded-full bg-green-500",
									status.type === "error" && "bg-red-500",
								)}
							/>
						)}
					</span>
				)}
			</div>
			<div className="h-36 overflow-y-auto pl-2 pt-2 pb-4">
				<LogContent />
			</div>
		</div>
	)
}
