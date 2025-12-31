import { useAtom } from "jotai"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "../lib/utils"
import { sidebarIsOpenAtom } from "../state/layout"

export function Main({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-row grow-1 h-full overflow-hidden">
			{children}
		</div>
	)
}

export function Sidebar({ children }: { children: ReactNode }) {
	const [isOpen, setIsOpen] = useAtom(sidebarIsOpenAtom)
	return (
		<div className="relative flex h-full min-h-0 flex-row z-10 group/sidebar">
			<div
				className={cn(
					"flex h-full min-h-0 flex-col w-0 overflow-hidden bg-slate-100",
					isOpen && "w-xs md:w-sm lg:w-md xl:w-lg",
				)}
			>
				{children}
			</div>
			<button
				type="button"
				onClick={() => setIsOpen((o) => !o)}
				className={cn(
					"absolute top-0 h-full w-4 flex items-center justify-center cursor-pointer",
					"bg-slate-200 hover:bg-slate-300",
					isOpen
						? "right-0 translate-x-full opacity-0 group-hover/sidebar:opacity-100"
						: "left-0 opacity-100",
				)}
				aria-label={isOpen ? "Close sidebar" : "Open sidebar"}
			>
				{isOpen ? (
					<ChevronLeft className="size-3" />
				) : (
					<ChevronRight className="size-3" />
				)}
			</button>
		</div>
	)
}

export function MapContent({ children }: { children: ReactNode }) {
	return <div className="relative grow-3 bg-slate-500">{children}</div>
}
