import { expect, test } from "vitest";

import { getFixtureFile, PBFs } from "../src/fixtures.ts";

test("the checked-in monaco fixture matches its public metadata", async () => {
  const fixture = await getFixtureFile(PBFs.monaco.url);

  expect(PBFs.monaco.url).toBe("monaco.pbf");
  expect(fixture.byteLength).toBeGreaterThan(0);
  expect(PBFs.monaco.nodes).toBeGreaterThan(0);
});
