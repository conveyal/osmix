import { createReadStream, readFileSync } from "node:fs";
import os from "node:os";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import { serve } from "@hono/node-server";
import type { Progress } from "@osmix/shared/progress";
import { createRemote } from "osmix";

import { createShortbreadServerApp } from "./app.ts";
import type { ShortbreadWorker } from "./shortbread.worker.ts";

export async function startShortbreadServer() {
  const filename = "monaco.pbf";
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  const pbfPath = fileURLToPath(new URL(`../../fixtures/${filename}`, import.meta.url));
  const indexHtml = readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
  const log: Progress[] = [];
  const remote = await createRemote<ShortbreadWorker>({
    workerCount: os.cpus().length,
    workerUrl: new URL("./shortbread.worker.ts", import.meta.url),
    onProgress: (event) => log.push(event),
  });
  const dataset = await remote.fromPbf(
    Readable.toWeb(createReadStream(pbfPath)) as ReadableStream,
    {
      id: filename,
    },
  );
  const state = { dataset, filename, log };
  const app = createShortbreadServerApp({ remote, state, indexHtml, port });

  console.log(`Number of workers available: ${os.cpus().length}`);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Shortbread vector tile server running at http://localhost:${info.port}`);
    console.log("Osmix initialized with Shortbread encoder");
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startShortbreadServer();
}
