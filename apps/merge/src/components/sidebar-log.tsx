import { ChevronDown } from "lucide-react"
import { useState } from "react"
import { useLog } from "../hooks/log"
import { cn } from "../lib/utils"
import LogContent from "./log"
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./ui/collapsible"
import { Spinner } from "./ui/spinner"

export default function SidebarLog() {
	const { activeTasks, log } = useLog()
	const status = log[log.length - 1]
	const [open, setOpen] = useState(false)
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className="border-t flex items-center justify-between px-4 py-2 h-8 shadow bg-white z-10 relative w-full cursor-pointer hover:bg-accent">
				<div className="font-bold uppercase">Activity Log</div>

				<div className="flex gap-4 items-center">
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
					<ChevronDown
						className={cn("transition-all size-4", open && "rotate-180")}
					/>
				</div>
			</CollapsibleTrigger>
			<CollapsibleContent
				className={cn(
					"h-0 bg-slate-50 flex transition-all flex-col overflow-x-auto overflow-y-auto gap-1 pb-4 px-2",
					open && "h-36 pt-2",
				)}
			>
				<LogContent />
			</CollapsibleContent>
		</Collapsible>
	)
}
