import CenterInfo from "@/components/center-info"
import ZoomInfo from "@/components/zoom-info"
import BrowserCheck from "./browser-check"
import Status from "./status"
import { NavLink } from "react-router"

export default function Nav() {
	return (
		<div className="border-b flex flex-row justify-between items-center px-4">
			<div className="flex flex-row gap-4 items-center py-2">
				<div className="font-bold">OSM.ts</div>
				<NavLink
					className={({ isActive }) =>
						isActive ? "text-blue-600" : "text-slate-950"
					}
					to="../merge"
					relative="path"
				>
					Merge
				</NavLink>
				<NavLink
					className={({ isActive }) =>
						isActive ? "text-blue-600" : "text-slate-950"
					}
					to="../view"
					relative="path"
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
