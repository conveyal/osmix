import { currentStatusAtom } from "@/atoms"
import CenterInfo from "@/components/center-info"
import ZoomInfo from "@/components/zoom-info"
import { cn } from "@/lib/utils"
import { useAtomValue } from "jotai"
import { Loader2Icon } from "lucide-react"
import { Button } from "./ui/button"
import { useSetAtom } from "jotai"
import { workflowStepAtom } from "@/atoms"

export default function Nav() {
	const setWorkflowStep = useSetAtom(workflowStepAtom)
	return (
		<div className="border-b flex flex-row justify-between items-center">
			<div className="flex flex-row gap-4 items-center px-4">
				<h1 className="py-2">OSM.ts</h1>
				{/* <Button
					onClick={() => setWorkflowStep("select-files")}
					size="sm"
					variant="link"
					className="cursor-pointer"
				>
					Merge
				</Button>
				<Button
					onClick={() => setWorkflowStep("view")}
					size="sm"
					variant="link"
					className="cursor-pointer"
				>
					View
				</Button> */}
			</div>

			<Status />
			<div className="flex flex-row gap-4 items-center px-4">
				<div className="border-r pr-4">
					<CenterInfo />
				</div>
				<div>
					<ZoomInfo />z
				</div>
			</div>
		</div>
	)
}

function Status() {
	const status = useAtomValue(currentStatusAtom)
	return (
		<div className="flex flex-row gap-2 items-center px-4">
			<div className="flex flex-row gap-2 items-center">
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
				<div>{status.message}</div>
			</div>
		</div>
	)
}
