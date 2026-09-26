import type { OsmNode } from "osmix";
import { describe, expect, it } from "vitest";

import { coveredClickNudge, inspectorView } from "../src/components/map-inspector.tsx";

const node: OsmNode = { id: 1, lon: 7.42, lat: 43.73 };

describe("inspectorView", () => {
  it("shows nothing in select mode without a selection", () => {
    expect(inspectorView("select", null)).toBeNull();
  });

  it("shows the selected entity in select mode", () => {
    expect(inspectorView("select", node)).toBe("entity");
  });

  it("shows the routing tool in route mode, even with a selection", () => {
    expect(inspectorView("route", null)).toBe("route");
    expect(inspectorView("route", node)).toBe("route");
  });
});

describe("coveredClickNudge", () => {
  it("is zero for a click clear of the panel", () => {
    expect(coveredClickNudge(100, 1440, 400)).toBe(0);
    expect(coveredClickNudge(1040, 1440, 400)).toBe(0);
  });

  it("moves a covered click to the panel's edge", () => {
    expect(coveredClickNudge(1300, 1440, 400)).toBe(260);
    expect(coveredClickNudge(1440, 1440, 400)).toBe(400);
  });

  it("rounds a fractional click up so it clears the edge", () => {
    expect(coveredClickNudge(1040.25, 1440, 400)).toBe(1);
  });
});
