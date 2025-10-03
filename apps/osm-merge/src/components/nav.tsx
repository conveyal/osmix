import { NavLink } from "react-router"
import CenterInfo from "@/components/center-info"
import ZoomInfo from "@/components/zoom-info"
import { cn } from "@/lib/utils"
import BrowserCheck from "./browser-check"
import Status from "./status"

export default function Nav() {
	return (
		<div className="border-b flex flex-row justify-between items-center px-4 h-12">
			<div className="flex flex-row gap-2 items-center">
				<div className="font-bold pr-2">Osmix</div>
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
					to="inspect"
				>
					Inspect
				</NavLink>
				<BrowserCheck />
			</div>

			<Status />

			<div className="flex flex-row gap-4 items-center">
				<div className=" whitespace-nowrap">
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
