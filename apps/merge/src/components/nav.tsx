import { SearchIcon } from "lucide-react"
import { NavLink } from "react-router"
import CenterInfo from "../components/center-info"
import ZoomInfo from "../components/zoom-info"
import { cn } from "../lib/utils"
import BrowserCheck from "./browser-check"
import { Button } from "./ui/button"
import { ButtonGroup, ButtonGroupSeparator } from "./ui/button-group"

export default function Nav() {
	return (
		<div className="shadow z-20 flex flex-row justify-between items-center px-4 h-8 bg-white">
			<div className="flex flex-row gap-2 items-center">
				<div className="font-bold pr-2">OSMIX</div>
				<NavLink
					className={({ isActive }) =>
						cn("text-slate-950 py-4 px-2", isActive && "text-blue-600")
					}
					to="/"
				>
					Merge
				</NavLink>
				<NavLink
					className={({ isActive }) =>
						cn("text-slate-950 py-4 px-2", isActive && "text-blue-600")
					}
					to="/inspect"
				>
					Inspect
				</NavLink>
				<BrowserCheck />
			</div>

			<ButtonGroup className="flex flex-row h-full items-center">
				<Button size="icon-sm" variant="ghost">
					<SearchIcon />
				</Button>
				<ButtonGroupSeparator />
				<div className="whitespace-nowrap px-4">
					<CenterInfo />
				</div>
				<ButtonGroupSeparator />
				<div className="pl-4">
					z<ZoomInfo />
				</div>
			</ButtonGroup>
		</div>
	)
}
