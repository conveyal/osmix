import { createReadStream, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import { serve } from "@hono/node-server";
import { createRemote } from "osmix";

import { createVtServerApp } from "./app.ts";

export async function startVtServer() {
  const filename = "monaco.pbf";
  const hostname = process.env.HOST ?? "127.0.0.1";
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const pbfPath = fileURLToPath(new URL(`../../fixtures/${filename}`, import.meta.url));
  const indexHtml = readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
  const log: string[] = [];
  const remote = await createRemote({
    inProcess: true,
    onProgress: (event) => log.push(event.msg),
  });
  const dataset = await remote.fromPbf(
    Readable.toWeb(createReadStream(pbfPath)) as ReadableStream,
    {
      id: filename,
    },
  );
  const app = createVtServerApp({ state: { dataset, filename, log }, indexHtml });

  console.log(`Osmix remote mode: ${remote.mode}`);
  serve({ fetch: app.fetch, hostname, port }, (info) => {
    const url = process.env.PORTLESS_URL ?? `http://${hostname}:${info.port}`;
    console.log(`Vector tile server running at ${url}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startVtServer();
}
