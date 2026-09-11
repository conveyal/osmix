import { describe, expect, it, vi } from "vitest";

import { writeJsonArray, writeJsonReport } from "../src/lib/json-download";

async function* pagesOf(...pages: unknown[][]) {
  yield* pages;
}

describe("paged diagnostic JSON download", () => {
  it.each([
    { pages: [] },
    { pages: [[]] },
    { pages: [[{ id: 1 }], []] },
    { pages: [[{ id: 1 }], [{ id: 2 }, { id: 3 }], []] },
  ])("writes a single parseable array across all pages (%j)", async ({ pages }) => {
    let json = "";
    const close = vi.fn(async () => {});
    const abort = vi.fn(async () => {});
    await writeJsonArray(
      {
        write: async (value) => {
          json += value;
        },
        close,
        abort,
      },
      pagesOf(...pages),
    );
    expect(JSON.parse(json)).toEqual(pages.flat());
    expect(close).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();
  });

  it("aborts the download and preserves a page-generation failure", async () => {
    const close = vi.fn(async () => {});
    const abort = vi.fn(async () => {
      throw Error("Cleanup failed");
    });
    async function* failedPages() {
      yield [{ id: 1 }];
      throw Error("Worker failed");
    }
    await expect(
      writeJsonArray({ write: async () => {}, close, abort }, failedPages()),
    ).rejects.toThrow("Worker failed");
    expect(close).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce();
  });
});

describe("completed merge report download", () => {
  it("writes the detached report and waits for the file to close", async () => {
    const report = { version: 1, inputs: ["base.pbf", "import.pbf"], unresolved: [101] };
    const write = vi.fn(async (_value: string) => {});
    const close = vi.fn(async () => {});
    const abort = vi.fn(async () => {});
    await writeJsonReport({ write, close, abort }, report);
    expect(JSON.parse(write.mock.calls[0][0])).toEqual(report);
    expect(close).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();
  });

  it("reports final close failures instead of claiming that the report was saved", async () => {
    const abort = vi.fn(async () => {});
    await expect(
      writeJsonReport(
        {
          write: async () => {},
          close: async () => {
            throw Error("Disk full");
          },
          abort,
        },
        { version: 1 },
      ),
    ).rejects.toThrow("Disk full");
    expect(abort).toHaveBeenCalledOnce();
  });
});
