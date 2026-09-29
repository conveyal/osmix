import { describe, expect, it } from "vitest";

import { cn } from "../src/lib/utils.ts";

describe("cn", () => {
  it("joins conditional classes like clsx", () => {
    const hidden = false;
    expect(cn("flex", hidden && "hidden", { "gap-2": true, "gap-4": false }, ["min-w-0"])).toBe(
      "flex gap-2 min-w-0",
    );
  });

  it("lets a later class replace a conflicting one", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("merges the theme's custom spacing and shadow keys", () => {
    expect(cn("p-inset", "p-0")).toBe("p-0");
    expect(cn("px-inset", "px-2")).toBe("px-2");
    expect(cn("shadow-raised", "shadow-none")).toBe("shadow-none");
    expect(cn("shadow-modal", "shadow-raised")).toBe("shadow-raised");
  });
});
