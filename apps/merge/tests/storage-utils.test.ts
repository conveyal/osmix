import { afterEach, describe, expect, it, vi } from "vitest";

import { canStoreBytes } from "../src/lib/storage-utils";

describe("canStoreBytes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("compares exact storable-transfer bytes with remaining quota", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: vi.fn().mockResolvedValue({
          quota: 2 * 2 ** 30,
          usage: 32 * 2 ** 20,
        }),
      },
    });

    await expect(canStoreBytes(4_095_437_400)).resolves.toEqual({
      canStore: false,
      availableBytes: 2 * 2 ** 30 - 32 * 2 ** 20,
      requiredBytes: 4_095_437_400,
    });
  });
});
