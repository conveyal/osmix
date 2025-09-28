import { useAtomValue } from "jotai"
import { Loader2Icon } from "lucide-react"
import { useHasActiveTasks } from "@/hooks/log"
import { cn } from "@/lib/utils"
import { currentStatusAtom } from "@/state/log"
import { formatTimestampMs } from "@/utils"
import LogContent from "./log"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card"

export default function Status() {
	const isActive = useHasActiveTasks()
	const status = useAtomValue(currentStatusAtom)
	return (
		<HoverCard openDelay={0}>
			<HoverCardTrigger className="flex flex-row gap-2 items-center no-underline">
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
				<div
					className="text-slate-950 no-underline"
					title={formatTimestampMs(status.timestamp)}
				>
					{status.message}
				</div>
			</HoverCardTrigger>
			<HoverCardContent className="max-h-96 overflow-y-scroll w-lg">
				<LogContent />
			</HoverCardContent>
		</HoverCard>
	)
}
