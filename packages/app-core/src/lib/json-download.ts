import type { OsmChangesetStats } from "osmix";

import { Tasks } from "../state/tasks.ts";
import { showSaveFilePickerWithFallback } from "./save-file-picker.ts";

interface JsonWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

/** Finish an object report only after every byte has been written successfully. */
export async function writeJsonReport(stream: JsonWritable, value: unknown): Promise<void> {
  try {
    await stream.write(`${JSON.stringify(value, null, 2)}\n`);
    await stream.close();
  } catch (error) {
    try {
      await stream.abort(error);
    } catch {
      // Preserve the original failure if aborting the file also fails.
    }
    throw error;
  }
}

/** Write one valid JSON array across pages, including an empty collection. */
export async function writeJsonArray(
  stream: JsonWritable,
  pages: AsyncIterable<readonly unknown[]>,
): Promise<void> {
  try {
    await stream.write("[");
    let first = true;
    for await (const page of pages) {
      if (page.length === 0) continue;
      const json = JSON.stringify(page);
      await stream.write(`${first ? "\n" : ",\n"}${json.slice(1, -1)}`);
      first = false;
    }
    await stream.write(first ? "]\n" : "\n]\n");
    await stream.close();
  } catch (error) {
    try {
      await stream.abort(error);
    } catch {
      // Keep the original generation/write error when cleanup also fails.
    }
    throw error;
  }
}

interface ChangesetPageSource {
  getChangesetPage(
    osmId: string,
    page: number,
    pageSize: number,
  ): Promise<{ changes?: readonly unknown[] | undefined }>;
}

const CHANGESET_JSON_PAGE_SIZE = 100_000;

/**
 * Ask for a destination, then stream the active changeset for `stats.osmId` to it as one JSON
 * array. The worker's current change and entity filters apply. Resolves without writing when the
 * user cancels the picker; any other failure rejects.
 */
export async function saveChangesetJson(
  remote: ChangesetPageSource,
  stats: OsmChangesetStats,
  suggestedName = "osm-changes.json",
): Promise<void> {
  const fileHandle = await showSaveFilePickerWithFallback({ suggestedName }, () => {
    Tasks.message("Native save picker unavailable, falling back to browser download");
  });
  if (!fileHandle) return;
  const stream = await fileHandle.createWritable();
  const { osmId } = stats;
  async function* changePages() {
    for (let page = 0; ; page++) {
      const result = await remote.getChangesetPage(osmId, page, CHANGESET_JSON_PAGE_SIZE);
      if (!result.changes || result.changes.length === 0) return;
      yield result.changes;
    }
  }
  await Tasks.run(
    `Save ${stats.totalChanges.toLocaleString()} changes as JSON`,
    () => writeJsonArray(stream, changePages()),
    { summary: () => `Saved ${fileHandle.name}` },
  );
}
