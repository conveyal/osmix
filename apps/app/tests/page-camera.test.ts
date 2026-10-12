import type { GeoBbox2D } from "osmix";
import { describe, expect, it } from "vitest";

import { boundsForPage } from "../src/lib/page-camera";

const monaco: GeoBbox2D = [7.4, 43.72, 7.44, 43.75];
const seattle: GeoBbox2D = [-122.44, 47.5, -122.24, 47.73];

describe("boundsForPage", () => {
  it("leaves the camera alone when a box is in view or there is nothing to show", () => {
    expect(boundsForPage([monaco], [7.3, 43.6, 7.5, 43.8])).toBeNull();
    expect(boundsForPage([seattle, monaco], [7.42, 43.73, 7.43, 43.74])).toBeNull();
    expect(boundsForPage([], seattle)).toBeNull();
  });

  it("fits every box when none is in view", () => {
    expect(boundsForPage([monaco], seattle)).toEqual(monaco);
    expect(boundsForPage([monaco, [7.5, 43.8, 7.6, 43.9]], seattle)).toEqual([
      7.4, 43.72, 7.6, 43.9,
    ]);
  });
});
