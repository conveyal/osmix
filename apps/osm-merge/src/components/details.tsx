import { cn } from "@/lib/utils"
import type { ClassValue } from "clsx"
import type { ReactNode } from "react"

export function Details({
	className,
	children,
	open = true,
}: {
	className?: ClassValue
	children: ReactNode
	open?: boolean
}) {
	return (
		<details open={open} className={cn("border-l border-b", className)}>
			{children}
		</details>
	)
}

export function DetailsSummary({
	className,
	children,
}: { className?: ClassValue; children: ReactNode }) {
	return (
		<summary className={cn("font-bold py-1 pl-2 cursor-pointer", className)}>
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
