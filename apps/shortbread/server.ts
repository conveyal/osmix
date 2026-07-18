import { createReadStream, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import { serve } from "@hono/node-server";
import type { Progress } from "@osmix/shared/progress";
import { selectWorkerCount } from "osmix";

import { createShortbreadServerApp } from "./app.ts";
import { createShortbreadRemote } from "./remote.ts";

export async function startShortbreadServer() {
  const filename = "monaco.pbf";
  const hostname = process.env.HOST ?? "127.0.0.1";
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  const pbfPath = fileURLToPath(new URL(`../../fixtures/${filename}`, import.meta.url));
  const indexHtml = readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
  const log: Progress[] = [];
  const workerCount = selectWorkerCount({
    hardwareConcurrency: availableParallelism(),
    reserveCores: 1,
  });
  const remote = await createShortbreadRemote({
    workerCount,
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
  const app = createShortbreadServerApp({ remote, state, indexHtml });

  console.log(`Number of workers available: ${remote.workerCount}`);
  serve({ fetch: app.fetch, hostname, port }, (info) => {
    const url = process.env.PORTLESS_URL ?? `http://${hostname}:${info.port}`;
    console.log(`Shortbread vector tile server running at ${url}`);
    console.log("Osmix initialized with Shortbread encoder");
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startShortbreadServer();
}
