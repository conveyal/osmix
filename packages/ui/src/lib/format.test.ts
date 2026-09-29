import { describe, expect, it } from "vitest";

import { formatDuration, formatElapsedClock } from "./format.ts";

describe("formatDuration", () => {
  it("uses milliseconds, then seconds, then a clock", () => {
    expect(formatDuration(812)).toBe("812ms");
    expect(formatDuration(2_310)).toBe("2.31s");
    expect(formatDuration(64_000)).toBe("1:04");
  });
});

describe("formatElapsedClock", () => {
  it("formats minutes and seconds, adding hours past one hour", () => {
    expect(formatElapsedClock(7_900)).toBe("0:07");
    expect(formatElapsedClock(754_000)).toBe("12:34");
    expect(formatElapsedClock(3_723_000)).toBe("1:02:03");
  });
});
