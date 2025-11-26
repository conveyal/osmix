import { Button, Spinner } from "@osmix/ui"
import { atom, useAtom } from "jotai"
import { useTransition } from "react"

const actionPendingAtom = atom(false)

export default function ActionButton({
	children,
	disabled,
	icon,
	onAction,
	...props
}: React.ComponentProps<typeof Button> & {
	icon?: React.ReactNode
	onAction: () => Promise<void>
}) {
	const [isPending, setIsPending] = useAtom(actionPendingAtom)
	const [isTransitioning, startTransition] = useTransition()
	return (
		<Button
			disabled={disabled || isTransitioning || isPending}
			onClick={(e) => {
				e.preventDefault()
				setIsPending(true)
				startTransition(async () => {
					try {
						await onAction()
					} finally {
						setIsPending(false)
					}
				})
			}}
			size={children ? "default" : "icon"}
			{...props}
		>
			{isTransitioning ? <Spinner /> : icon} {children}
		</Button>
	)
}
