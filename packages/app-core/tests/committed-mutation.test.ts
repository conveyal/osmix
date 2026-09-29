import { describe, expect, it } from "vitest";

import { committedMutationOsmId } from "../src/lib/committed-mutation.ts";

describe("committedMutationOsmId", () => {
  it("returns the dataset ID only for a committed mutation of the requested operation", () => {
    expect(committedMutationOsmId({ osmId: "base", committed: false }, "merge")).toBeNull();
    expect(
      committedMutationOsmId({ osmId: "base", committed: true, operation: "merge" }, "merge"),
    ).toBe("base");
    expect(
      committedMutationOsmId(
        { osmId: "base", committed: true, operation: "merge" },
        "applyChangesAndReplace",
      ),
    ).toBeNull();
    expect(
      committedMutationOsmId(
        { osmId: "base", committed: true, operation: "applyMergePlan" },
        "applyMergePlan",
      ),
    ).toBe("base");
    expect(committedMutationOsmId(new Error("failed"), "merge")).toBeNull();
  });
});
