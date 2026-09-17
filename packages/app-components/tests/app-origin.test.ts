import { describe, expect, it } from "vitest";

import { appOrigin } from "../src/lib/app-origin.ts";

describe("appOrigin", () => {
  it("swaps the app label on a production host", () => {
    expect(
      appOrigin("inspect", { hostname: "merge.osmix.dev", protocol: "https:", port: "" }),
    ).toBe("https://inspect.osmix.dev");
  });

  it("swaps the app label on a Portless host, keeping a worktree prefix", () => {
    expect(
      appOrigin("merge", {
        hostname: "my-branch.inspect.osmix.localhost",
        protocol: "https:",
        port: "",
      }),
    ).toBe("https://my-branch.merge.osmix.localhost");
  });

  it("swaps the real app label when the worktree prefix is itself an app name", () => {
    expect(
      appOrigin("inspect", {
        hostname: "inspect.merge.osmix.localhost",
        protocol: "https:",
        port: "",
      }),
    ).toBe("https://inspect.inspect.osmix.localhost");
  });

  it("keeps an explicit port", () => {
    expect(
      appOrigin("inspect", { hostname: "merge.osmix.localhost", protocol: "http:", port: "4173" }),
    ).toBe("http://inspect.osmix.localhost:4173");
  });

  it("falls back to the production origin when the host carries no app label", () => {
    expect(appOrigin("inspect", { hostname: "localhost", protocol: "http:", port: "5173" })).toBe(
      "https://inspect.osmix.dev",
    );
  });
});
