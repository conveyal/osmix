import { describe, expect, it } from "vitest";

import { waysIntersect } from "../src/utils.ts";

type Point = [number, number];

describe("waysIntersect", () => {
  const cases: [string, Point[], Point[], Point[]][] = [
    [
      "crossing",
      [
        [0, 0],
        [2, 2],
      ],
      [
        [0, 2],
        [2, 0],
      ],
      [[1, 1]],
    ],
    [
      "shared endpoint",
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [1, 1],
      ],
      [[1, 0]],
    ],
    [
      "collinear overlap",
      [
        [0, 0],
        [2, 0],
      ],
      [
        [1, 0],
        [3, 0],
      ],
      [],
    ],
    [
      "vertical and horizontal",
      [
        [1, -2],
        [1, 2],
      ],
      [
        [-2, 0],
        [2, 0],
      ],
      [[1, 0]],
    ],
    [
      "multiple segments",
      [
        [0, 0],
        [2, 2],
        [4, 0],
      ],
      [
        [0, 2],
        [2, 0],
        [4, 2],
      ],
      [
        [1, 1],
        [3, 1],
      ],
    ],
    [
      "duplicate vertices",
      [
        [0, 0],
        [1, 1],
        [1, 1],
        [2, 0],
      ],
      [
        [0, 1],
        [2, 1],
      ],
      [[1, 1]],
    ],
    [
      "degenerate segment",
      [
        [0, 0],
        [0, 0],
      ],
      [
        [-1, 0],
        [1, 0],
      ],
      [],
    ],
    [
      "self-intersection",
      [
        [0, 0],
        [2, 2],
        [0, 2],
        [2, 0],
      ],
      [
        [-1, 1],
        [3, 1],
      ],
      [[1, 1]],
    ],
  ];

  it.each(cases)("matches pinned behavior for %s", (_name, wayA, wayB, expected) => {
    expect(waysIntersect(wayA, wayB)).toEqual(expected);
  });
});
