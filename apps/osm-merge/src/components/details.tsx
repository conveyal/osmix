import { cn } from "@/lib/utils"
import type { ClassValue } from "clsx"
import type { ReactNode } from "react"

export function Details({
	className,
	children,
	open,
}: {
	className?: ClassValue
	children: ReactNode
	open?: boolean
}) {
	return (
		<details
			open={open}
			className={cn("border-b border-l border-slate-950", className)}
		>
			{children}
		</details>
	)
}

export function DetailsSummary({
	className,
	children,
}: { className?: ClassValue; children: ReactNode }) {
	return (
		<summary className={cn("font-bold p-1 cursor-pointer shadow", className)}>
			{children}
		</summary>
	)
}

export function DetailsContent({
	className,
	children,
}: { className?: ClassValue; children: ReactNode }) {
	return <div className={cn("", className)}>{children}</div>
}
