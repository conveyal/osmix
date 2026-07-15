import { describe, expect, it } from "vitest";

import { CliUsageError, parseCliArgs } from "../src/args.ts";

describe("parseCliArgs", () => {
  it("accepts one PBF path", () => {
    expect(parseCliArgs(["monaco.pbf"])).toEqual({ kind: "view", filePath: "monaco.pbf" });
  });

  it("recognizes help", () => {
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
  });

  it.each([{ args: [] }, { args: ["one.pbf", "two.pbf"] }, { args: ["--unknown"] }])(
    "rejects invalid arguments: $args",
    ({ args }) => {
      expect(() => parseCliArgs(args)).toThrow(CliUsageError);
    },
  );
});
