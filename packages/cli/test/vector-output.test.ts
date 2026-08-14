import { createTerminalCapabilities } from "@opentui/core/testing";
import { describe, expect, it } from "vitest";

import { resolveVectorOutputMode, vectorPixelSize } from "../src/vector-output.ts";

describe("vector terminal output", () => {
  it("uses Kitty graphics instead of quadrant cells when the terminal supports it", () => {
    const capabilities = createTerminalCapabilities({ kitty_graphics: true });
    expect(resolveVectorOutputMode(capabilities, false, {})).toBe("kitty");
  });

  it("uses Sixel only when OpenTUI knows the terminal pixel resolution", () => {
    const capabilities = createTerminalCapabilities({ sixel: true });
    expect(resolveVectorOutputMode(capabilities, false, {})).toBe("quadrants");
    expect(resolveVectorOutputMode(capabilities, true, {})).toBe("sixel");
  });

  it("preserves quadrant output as the compatibility fallback", () => {
    const capabilities = createTerminalCapabilities();
    expect(resolveVectorOutputMode(capabilities, true, {})).toBe("quadrants");
    expect(
      resolveVectorOutputMode(createTerminalCapabilities({ kitty_graphics: true }), true, {
        OPENTUI_GRAPHICS: "false",
      }),
    ).toBe("quadrants");
  });

  it("honors an explicit OpenTUI image protocol override", () => {
    expect(resolveVectorOutputMode(null, false, { OPENTUI_IMAGE_PROTOCOL: "kitty" })).toBe("kitty");
    expect(resolveVectorOutputMode(null, true, { OPENTUI_IMAGE_PROTOCOL: "sixel" })).toBe("sixel");
  });

  it("renders at the map area's proportional terminal-pixel size", () => {
    expect(vectorPixelSize(120, 39, 120, 40, { width: 1_200, height: 800 })).toEqual({
      height: 780,
      width: 1_200,
    });
    expect(vectorPixelSize(80, 23, 80, 24, { width: 800, height: 480 })).toEqual({
      height: 460,
      width: 800,
    });
  });

  it("uses a pixel-cell estimate before Kitty reports a resolution", () => {
    expect(vectorPixelSize(100, 29, 100, 30, null)).toEqual({
      height: 464,
      width: 800,
    });
  });

  it("caps large readbacks without changing their aspect ratio", () => {
    const size = vectorPixelSize(240, 70, 240, 70, { width: 3_840, height: 2_160 });
    expect(size.width).toBeLessThanOrEqual(2_048);
    expect(size.height).toBeLessThanOrEqual(2_048);
    expect(size.width * size.height).toBeLessThanOrEqual(2_000_000);
    expect(size.width / size.height).toBeCloseTo(3_840 / 2_160, 2);
  });
});
