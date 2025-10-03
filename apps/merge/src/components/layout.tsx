import type { ReactNode } from "react"

export function Main({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-row grow-1 h-full overflow-hidden">
			{children}
		</div>
	)
}

export function Sidebar({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col w-lg gap-2 overflow-y-auto overflow-x-hidden">
			{children}
		</div>
	)
}

export function MapContent({ children }: { children: ReactNode }) {
	return <div className="relative grow-3 bg-slate-500">{children}</div>
}
