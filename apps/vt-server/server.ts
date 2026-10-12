import { createReadStream, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getRequestListener } from "@hono/node-server";
import { createRemote } from "osmix";
import { createServer as createViteServer } from "vite";

import { createVtServerApp } from "./app.ts";

export async function startVtServer() {
  const filename = "monaco.pbf";
  const hostname = process.env.HOST ?? "127.0.0.1";
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const pbfPath = fileURLToPath(new URL(`../../fixtures/${filename}`, import.meta.url));
  // Vite serves `client.ts` and `main.css`, which import packages from node_modules. API routes
  // fall through to Hono.
  let honoListener: ReturnType<typeof getRequestListener> | undefined;
  const server = createServer((req, res) => {
    vite.middlewares(req, res, () => {
      if (honoListener) return honoListener(req, res);
      res.writeHead(503).end("Server is starting");
    });
  });
  const vite = await createViteServer({
    root: import.meta.dirname,
    appType: "custom",
    server: { hmr: { server }, middlewareMode: true },
  });
  server.on("close", () => void vite.close());
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
  honoListener = getRequestListener(app.fetch);
  server.listen(port, hostname, () => {
    const url = process.env.PORTLESS_URL ?? `http://${hostname}:${port}`;
    console.log(`Vector tile server running at ${url}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startVtServer();
}
