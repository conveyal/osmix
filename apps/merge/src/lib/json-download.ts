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
