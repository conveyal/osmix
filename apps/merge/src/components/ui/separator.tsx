import { Separator as BaseSeparator } from "@base-ui/react/separator"
import type * as React from "react"

import { cn } from "../../lib/utils"

function Separator({
	className,
	orientation = "horizontal",
	decorative = true,
	...props
}: React.ComponentProps<typeof BaseSeparator> & {
	decorative?: boolean
}) {
	return (
		<BaseSeparator
			data-slot="separator"
			aria-hidden={decorative}
			orientation={orientation}
			className={cn(
				"bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
				className,
			)}
			{...props}
		/>
	)
}

export { Separator }
