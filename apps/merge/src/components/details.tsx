import type { ClassValue } from "clsx"
import type { ReactNode } from "react"
import { cn } from "../lib/utils"

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
		<details open={open} className={cn("border", className)}>
			{children}
		</details>
	)
}

export function DetailsSummary({
	className,
	children,
}: {
	className?: ClassValue
	children: ReactNode
}) {
	return (
		<summary className={cn("font-bold py-1 pl-2 cursor-pointer", className)}>
			&nbsp;
			{children}
		</summary>
	)
}

export function DetailsContent({
	className,
	children,
}: {
	className?: ClassValue
	children: ReactNode
}) {
	return <div className={cn("", className)}>{children}</div>
}
