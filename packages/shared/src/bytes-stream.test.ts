import { expect, test } from "vitest";

import { bytesToStream } from "./bytes-to-stream.ts";
import { streamToBytes } from "./stream-to-bytes.ts";

test("bytes streams round-trip without changing payload", async () => {
  const input = new Uint8Array([0, 1, 2, 255]);
  const output = await streamToBytes(bytesToStream(input));

  expect(output).toEqual(input);
});
