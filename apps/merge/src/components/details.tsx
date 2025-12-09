import type { ClassValue } from "clsx"
import { ChevronUp } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "../lib/utils"
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./ui/collapsible"

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
		<Collapsible defaultOpen={open} className={cn("w-full", className)}>
			{children}
		</Collapsible>
	)
}

/**
 * TODO: properly rotate the chevron when open. Right now, the state=open is applied to hte trigger, so we have to trickle it down to the icon somehow.
 * ALSO: Only show the shadow on open
 */
export function DetailsSummary({
	className,
	children,
}: {
	className?: ClassValue
	children: ReactNode
}) {
	return (
		<CollapsibleTrigger
			className={cn(
				"border-t w-full flex justify-between items-center p-2 cursor-pointer hover:bg-accent transition-colors h-8 data-[state=open]:shadow-sm",
				className,
			)}
		>
			<div className="font-bold uppercase">{children}</div>
			<ChevronUp className="size-4" />
		</CollapsibleTrigger>
	)
}

export function DetailsContent({
	className,
	children,
}: {
	className?: ClassValue
	children: ReactNode
}) {
	return (
		<CollapsibleContent className={cn("", className)}>
			{children}
		</CollapsibleContent>
	)
}
