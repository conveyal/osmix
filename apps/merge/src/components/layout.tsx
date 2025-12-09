import { useAtomValue } from "jotai"
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
	const isOpen = useAtomValue(sidebarIsOpenAtom)
	return (
		<div
			className={cn(
				"flex h-full min-h-0 flex-col w-0 transition-all overflow-hidden z-10 bg-slate-100",
				isOpen && "w-lg",
			)}
		>
			{children}
		</div>
	)
}

export function MapContent({ children }: { children: ReactNode }) {
	return <div className="relative grow-3 bg-slate-500">{children}</div>
}
