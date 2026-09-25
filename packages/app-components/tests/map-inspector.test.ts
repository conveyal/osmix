import type { OsmNode } from "osmix";
import { describe, expect, it } from "vitest";

import { inspectorView } from "../src/components/map-inspector.tsx";

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
