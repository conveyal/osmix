/**
 * Clip polylines and polygons to an axis-aligned bounding box.
 *
 * A typed port of `lineclip` 2.0.0 (ISC, Mapbox); see `THIRD_PARTY_NOTICES.md`.
 *
 * @module
 */

type Point = [number, number];
type Bbox = [minX: number, minY: number, maxX: number, maxY: number];

/**
 * Clip a polyline to a bbox with the Cohen-Sutherland algorithm, adapted to
 * handle polylines rather than single segments. Returns the parts inside the
 * bbox; a line that leaves and re-enters becomes several parts.
 */
export function clipPolyline(points: Point[], bbox: Bbox): Point[][] {
  const len = points.length;
  const result: Point[][] = [];
  let codeA = bitCode(points[0]!, bbox);
  let part: Point[] = [];

  for (let i = 1; i < len; i++) {
    let a = points[i - 1]!;
    let b = points[i]!;
    const lastCode = bitCode(b, bbox);
    let codeB = lastCode;

    while (true) {
      if (!(codeA | codeB)) {
        // accept
        part.push(a);

        if (codeB !== lastCode) {
          // segment went outside
          part.push(b);

          if (i < len - 1) {
            // start a new line
            result.push(part);
            part = [];
          }
        } else if (i === len - 1) {
          part.push(b);
        }
        break;
      } else if (codeA & codeB) {
        // trivial reject
        break;
      } else if (codeA) {
        // a outside, intersect with clip edge
        a = intersect(a, b, codeA, bbox);
        codeA = bitCode(a, bbox);
      } else {
        // b outside
        b = intersect(a, b, codeB, bbox);
        codeB = bitCode(b, bbox);
      }
    }

    codeA = lastCode;
  }

  if (part.length) result.push(part);

  return result;
}

/**
 * Clip a polygon ring to a bbox with the Sutherland-Hodgman algorithm.
 * Returns the clipped ring, which is empty when the ring is outside the bbox.
 */
export function clipPolygon(points: Point[], bbox: Bbox): Point[] {
  let ring = points;
  let result: Point[] = [];

  // clip against each side of the clip rectangle
  for (let edge = 1; edge <= 8; edge *= 2) {
    result = [];
    let prev = ring[ring.length - 1]!;
    let prevInside = !(bitCode(prev, bbox) & edge);

    for (const p of ring) {
      const inside = !(bitCode(p, bbox) & edge);

      // if segment goes through the clip window, add an intersection
      if (inside !== prevInside) result.push(intersect(prev, p, edge, bbox));

      if (inside) result.push(p); // add a point if it's inside

      prev = p;
      prevInside = inside;
    }

    ring = result;

    if (!ring.length) break;
  }

  return result;
}

/** Intersect a segment with one of the four lines that make up the bbox. */
function intersect(a: Point, b: Point, edge: number, bbox: Bbox): Point {
  if (edge & 8) return [a[0] + ((b[0] - a[0]) * (bbox[3] - a[1])) / (b[1] - a[1]), bbox[3]]; // top
  if (edge & 4) return [a[0] + ((b[0] - a[0]) * (bbox[1] - a[1])) / (b[1] - a[1]), bbox[1]]; // bottom
  if (edge & 2) return [bbox[2], a[1] + ((b[1] - a[1]) * (bbox[2] - a[0])) / (b[0] - a[0])]; // right
  return [bbox[0], a[1] + ((b[1] - a[1]) * (bbox[0] - a[0])) / (b[0] - a[0])]; // left
}

// bit code reflects the point position relative to the bbox:

//         left  mid  right
//    top  1001  1000  1010
//    mid  0001  0000  0010
// bottom  0101  0100  0110

function bitCode(p: Point, bbox: Bbox): number {
  let code = 0;

  if (p[0] < bbox[0]) code |= 1; // left
  else if (p[0] > bbox[2]) code |= 2; // right

  if (p[1] < bbox[1]) code |= 4; // bottom
  else if (p[1] > bbox[3]) code |= 8; // top

  return code;
}
