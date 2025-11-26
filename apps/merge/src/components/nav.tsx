import { Separator } from "@osmix/ui"
import CenterInfo from "../components/center-info"
import ZoomInfo from "../components/zoom-info"
import BrowserCheck from "./browser-check"

export default function Nav() {
	return (
		<div className="border-b shadow flex flex-row justify-between items-center px-4 h-12">
			<div className="flex flex-row gap-2 items-center">
				<div className="font-bold pr-2">OSMIX MERGE</div>
				<BrowserCheck />
			</div>

			<div className="flex flex-row gap-4 h-6 items-center">
				<div className="whitespace-nowrap">
					<CenterInfo />
				</div>
				<Separator orientation="vertical" />
				<div>
					z<ZoomInfo />
				</div>
			</div>
		</div>
	)
}
