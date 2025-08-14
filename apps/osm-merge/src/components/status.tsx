import { currentStatusAtom } from "@/state/log"
import { cn } from "@/lib/utils"
import { useAtomValue } from "jotai"
import { Loader2Icon } from "lucide-react"
import { formatTimestampMs } from "@/utils"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card"
import LogContent from "./log"

export default function Status() {
	const status = useAtomValue(currentStatusAtom)
	return (
		<HoverCard openDelay={0}>
			<HoverCardTrigger className="flex flex-row gap-2 items-center">
				{status.type === "info" ? (
					<Loader2Icon className="animate-spin size-4" />
				) : (
					<div
						className={cn(
							"w-2 h-2 rounded-full",
							status.type === "ready" && "bg-green-500",
							status.type === "error" && "bg-red-500",
						)}
					/>
				)}
				<div>
					{formatTimestampMs(status.timestamp)} &rarr; {status.message}
				</div>
			</HoverCardTrigger>
			<HoverCardContent className="max-h-96 overflow-y-scroll w-96">
				<LogContent />
			</HoverCardContent>
		</HoverCard>
	)
}
