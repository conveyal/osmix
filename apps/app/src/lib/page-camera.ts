import type { GeoBbox2D } from "osmix";

function overlaps(a: GeoBbox2D, b: GeoBbox2D): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/**
 * Where to move the shared map when a page opens: the union of the page's `boxes` when none of
 * them is in the current `view`, so the page never opens on an empty map, or null to leave the
 * camera where it is (a box is in view, or the page has nothing to show).
 */
export function boundsForPage(boxes: readonly GeoBbox2D[], view: GeoBbox2D): GeoBbox2D | null {
  if (boxes.length === 0 || boxes.some((box) => overlaps(box, view))) return null;
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ];
}
