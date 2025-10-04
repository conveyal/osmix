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
		<div className="flex h-full min-h-0 flex-col w-lg overflow-hidden">
			{children}
		</div>
	)
}

export function MapContent({ children }: { children: ReactNode }) {
	return <div className="relative grow-3 bg-slate-500">{children}</div>
}
