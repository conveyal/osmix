import { type PrimitiveAtom, useAtom } from "jotai"
import { Layers, Navigation, SearchIcon, SidebarClose } from "lucide-react"
import { NavLink } from "react-router"
import CenterInfo from "../components/center-info"
import ZoomInfo from "../components/zoom-info"
import { cn } from "../lib/utils"
import { sidebarIsOpenAtom } from "../state/layout"
import {
	layerControlIsOpenAtom,
	routingControlIsOpenAtom,
	searchControlIsOpenAtom,
} from "../state/map"
import BrowserCheck from "./browser-check"
import Status from "./status"
import { Button } from "./ui/button"
import { ButtonGroup, ButtonGroupSeparator } from "./ui/button-group"

export default function Nav() {
	return (
		<div className="shadow z-20 flex flex-row justify-between items-center px-2 lg:px-4 h-10 bg-white">
			<div className="flex flex-row gap-2 items-center">
				<div className="font-bold pr-2">OSMIX</div>
				<NavLink
					className={({ isActive }) =>
						cn(
							"text-slate-950 py-4 px-2 uppercase",
							isActive && "text-blue-600",
						)
					}
					to="/"
				>
					Merge
				</NavLink>
				<NavLink
					className={({ isActive }) =>
						cn(
							"text-slate-950 py-4 px-2 uppercase",
							isActive && "text-blue-600",
						)
					}
					to="/inspect"
				>
					Inspect
				</NavLink>
				<BrowserCheck />
			</div>

			<Status />

			<ButtonGroup className="flex flex-row h-full items-center gap-1">
				<ToggleButton atom={sidebarIsOpenAtom}>
					<SidebarClose />
				</ToggleButton>
				<ToggleButton atom={routingControlIsOpenAtom}>
					<Navigation />
				</ToggleButton>
				<ToggleButton atom={layerControlIsOpenAtom}>
					<Layers />
				</ToggleButton>
				<ToggleButton atom={searchControlIsOpenAtom}>
					<SearchIcon />
				</ToggleButton>
				<ButtonGroupSeparator />
				<div className="whitespace-nowrap px-2">
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

function ToggleButton({
	atom,
	children,
}: {
	atom: PrimitiveAtom<boolean>
	children: React.ReactNode
}) {
	const [isOpen, setIsOpen] = useAtom(atom)
	return (
		<Button
			className={cn(isOpen ? "text-blue-500" : "text-muted-foreground")}
			size="icon-sm"
			variant="ghost"
			onClick={() => setIsOpen((o) => !o)}
		>
			{children}
		</Button>
	)
}
