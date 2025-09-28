import { flattenValue } from "../utils"

export default function ObjectToTableRows({
	object,
}: {
	object: null | Record<string, string | number | boolean | unknown>
}) {
	if (!object) return null
	return (
		<>
			{Object.entries(object)
				.filter(([_key, value]) => {
					return typeof value !== "undefined"
				})
				.map(([key, value]) => {
					const valueString =
						key.includes("timestamp") && typeof value === "number"
							? new Date(value).toLocaleString()
							: flattenValue(value)
					return (
						<tr key={key}>
							<td>{key}</td>
							<td>{valueString}</td>
						</tr>
					)
				})}
		</>
	)
}
