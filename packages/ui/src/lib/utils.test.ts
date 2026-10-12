import { describe, expect, it } from "vitest";

import { cn } from "./utils.ts";

describe("cn", () => {
  it("lets a call-site padding override the inset token", () => {
    expect(cn("w-full p-inset", "p-0")).toBe("w-full p-0");
    expect(cn("px-inset py-1.5", "px-2")).toBe("py-1.5 px-2");
  });

  it("lets a call-site shadow override the elevation tokens", () => {
    expect(cn("shadow-raised", "shadow-none")).toBe("shadow-none");
    expect(cn("shadow-modal", "shadow-raised")).toBe("shadow-raised");
  });
});
