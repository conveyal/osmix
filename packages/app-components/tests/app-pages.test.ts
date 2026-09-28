import { describe, expect, it } from "vitest";

import { pagePath, routeForPath } from "../src/lib/app-pages.ts";

describe("app pages", () => {
  it("maps paths to pages and Home", () => {
    expect(routeForPath("/")).toBe("home");
    expect(routeForPath("")).toBe("home");
    expect(routeForPath("/merge")).toBe("merge");
    expect(routeForPath("/inspect/")).toBe("inspect");
    expect(routeForPath("/extract")).toBe("extract");
  });

  it("does not match unknown or nested paths", () => {
    expect(routeForPath("/merges")).toBeNull();
    expect(routeForPath("/merge/plan")).toBeNull();
    expect(routeForPath("/e2e/worker-harness.html")).toBeNull();
  });

  it("gives each page its path", () => {
    expect(pagePath("inspect")).toBe("/inspect");
  });
});
