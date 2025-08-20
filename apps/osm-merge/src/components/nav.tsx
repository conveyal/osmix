import CenterInfo from "@/components/center-info"
import ZoomInfo from "@/components/zoom-info"
import BrowserCheck from "./browser-check"
import Status from "./status"
import { NavLink } from "react-router"
import { cn } from "@/lib/utils"

export default function Nav() {
	return (
		<div className="border-b flex flex-row justify-between items-center px-4 h-12">
			<div className="flex flex-row gap-2 items-center">
				<div className="font-bold pr-2">OSM.ts</div>
				<NavLink
					className={({ isActive }) =>
						cn("text-slate-950 py-4 px-2", isActive && "text-blue-600")
					}
					to="merge"
				>
					Merge
				</NavLink>
				<NavLink
					className={({ isActive }) =>
						cn("text-slate-950 py-4 px-2", isActive && "text-blue-600")
					}
					to="view"
				>
					View
				</NavLink>
				{process.env.NODE_ENV === "development" && <BrowserCheck />}
			</div>

			<Status />

			<div className="flex flex-row gap-4 items-center">
				<div>
					<CenterInfo />
				</div>
				<hr className="border-r h-4" />
				<div>
					z<ZoomInfo />
				</div>
			</div>
		</div>
	)
}
