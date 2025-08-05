import { useAtomValue } from "jotai"
import { logAtom } from "@/atoms"

export default function Log() {
	const log = useAtomValue(logAtom)
	return (
		<div className="flex flex-col-reverse h-full overflow-x-auto overflow-y-auto border border-gray-200 p-2 text-xs">
			{log.toReversed().map((message, index) => (
				<div
					key={`${index}-${message.timestamp}`}
					className="whitespace-nowrap"
				>
					{(message.duration / 1000).toFixed(3)}s &rarr; {message.message}
				</div>
			))}
		</div>
	)
}
