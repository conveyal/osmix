import CenterInfo from "@/components/center-info"
import ZoomInfo from "@/components/zoom-info"
import BrowserCheck from "./browser-check"
import Status from "./status"

export default function Nav() {
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
				{process.env.NODE_ENV === "development" && <BrowserCheck />}
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
