declare module "lineclip" {
	export function clipPolyline(
		points: [number, number][],
		bbox: [number, number, number, number],
	): [number, number][][]
}
