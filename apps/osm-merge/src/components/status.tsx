import { currentStatusAtom } from "@/state/log"
import { cn } from "@/lib/utils"
import { useAtomValue } from "jotai"
import { Loader2Icon } from "lucide-react"
import { formatTimestampMs } from "@/utils"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card"
import LogContent from "./log"
import useTaskStatus from "@/hooks/task-status"

export default function Status() {
	const [isActive] = useTaskStatus()
	const status = useAtomValue(currentStatusAtom)
	return (
		<HoverCard openDelay={0}>
			<HoverCardTrigger className="flex flex-row gap-2 items-center">
				{isActive ? (
					<Loader2Icon className="animate-spin size-4" />
				) : (
					<div
						className={cn(
							"w-2 h-2 rounded-full bg-green-500",
							status.type === "error" && "bg-red-500",
						)}
					/>
				)}
				<div>
					[{formatTimestampMs(status.timestamp)}] {status.message}
				</div>
			</HoverCardTrigger>
			<HoverCardContent className="max-h-96 overflow-y-scroll w-lg">
				<LogContent />
			</HoverCardContent>
		</HoverCard>
	)
}
