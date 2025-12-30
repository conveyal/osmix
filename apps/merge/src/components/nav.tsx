import { type PrimitiveAtom, useAtom } from "jotai"
import {
	FileIcon,
	Layers,
	Navigation,
	SearchIcon,
	SidebarClose,
} from "lucide-react"
import { NavLink } from "react-router"
import CenterInfo from "../components/center-info"
import ZoomInfo, { ZoomInButton, ZoomOutButton } from "../components/zoom-info"
import { cn } from "../lib/utils"
import { sidebarIsOpenAtom } from "../state/layout"
import {
	layerControlIsOpenAtom,
	osmFileControlIsOpenAtom,
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
				<a
					href="https://github.com/conveyal/osmix"
					target="_blank"
					rel="noopener noreferrer"
					className="hover:opacity-50 size-4"
				>
					<GithubLogo />
				</a>
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
				<ToggleButton atom={osmFileControlIsOpenAtom}>
					<FileIcon />
				</ToggleButton>
				<ButtonGroupSeparator />
				<div className="whitespace-nowrap px-2">
					<CenterInfo />
				</div>
				<ButtonGroupSeparator />
				<div className="flex items-center gap-1">
					<ZoomOutButton />
					<div>
						z<ZoomInfo />
					</div>
					<ZoomInButton />
				</div>
				<ButtonGroupSeparator />
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

export function GithubLogo() {
	return (
		<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
			<title>GitHub</title>
			<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
		</svg>
	)
}
