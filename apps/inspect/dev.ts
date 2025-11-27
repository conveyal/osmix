#!/usr/bin/env bun
/**
 * Development server for @osmix/inspect using Bun.
 *
 * This provides:
 * - Static file serving from src/
 * - TypeScript/TSX transpilation on-the-fly
 * - CSS processing via Tailwind CLI (watch mode in separate process)
 * - Required CORS headers for SharedArrayBuffer support
 *
 * Note: This does NOT provide Hot Module Replacement (HMR) or React Fast Refresh.
 * For the best development experience, consider using Vite instead.
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { extname, join } from "node:path"

const ROOT = import.meta.dirname
const SRC = join(ROOT, "src")
const FIXTURES = join(ROOT, "../../fixtures")
const PORT = 5174

// CORS headers required for SharedArrayBuffer
const corsHeaders = {
	"Cross-Origin-Embedder-Policy": "require-corp",
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Resource-Policy": "same-origin",
	"Access-Control-Allow-Origin": "*",
}

// Content type mapping
const contentTypes: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".mjs": "application/javascript",
	".jsx": "application/javascript",
	".ts": "application/javascript",
	".tsx": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".ico": "image/x-icon",
	".pbf": "application/x-protobuf",
}

// Start Tailwind in watch mode
console.log("Starting Tailwind CSS watch mode...")
const tailwindProcess = spawn(
	"bunx",
	[
		"@tailwindcss/cli",
		"-i",
		join(SRC, "main.css"),
		"-o",
		join(ROOT, ".dev/main.css"),
		"--watch",
	],
	{
		stdio: "inherit",
		cwd: ROOT,
	},
)

// Ensure .dev directory exists
const devDir = join(ROOT, ".dev")
if (!existsSync(devDir)) {
	await Bun.write(join(devDir, ".gitkeep"), "")
}

// Generate index.html for development
const devIndexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Osmix Inspect (Dev)</title>
    <link rel="stylesheet" href="/.dev/main.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`

async function handleRequest(req: Request): Promise<Response> {
	const url = new URL(req.url)
	const pathname = url.pathname

	// Handle root
	if (pathname === "/" || pathname === "/index.html") {
		return new Response(devIndexHtml, {
			headers: { ...corsHeaders, "Content-Type": "text/html" },
		})
	}

	// Try to serve from various locations
	const possiblePaths = [
		join(ROOT, pathname), // Root-relative (e.g., /src/main.tsx)
		join(ROOT, pathname.replace(/^\//, "")), // Without leading slash
		join(FIXTURES, pathname.replace(/^\//, "")), // Fixtures directory
	]

	for (const filePath of possiblePaths) {
		if (existsSync(filePath)) {
			const ext = extname(filePath)

			// Transpile TypeScript/TSX files
			if (ext === ".ts" || ext === ".tsx") {
				try {
					const result = await Bun.build({
						entrypoints: [filePath],
						target: "browser",
						format: "esm",
						define: {
							"process.env.NODE_ENV": JSON.stringify("development"),
						},
					})

					if (!result.success) {
						return new Response(
							`Build error:\n${result.logs.map((l) => l.message).join("\n")}`,
							{
								status: 500,
								headers: { ...corsHeaders, "Content-Type": "text/plain" },
							},
						)
					}

					const output = result.outputs[0]
					if (output) {
						const code = await output.text()
						return new Response(code, {
							headers: {
								...corsHeaders,
								"Content-Type": "application/javascript",
							},
						})
					}
				} catch (error) {
					return new Response(`Transpile error: ${error}`, {
						status: 500,
						headers: { ...corsHeaders, "Content-Type": "text/plain" },
					})
				}
			}

			// Serve static files
			const file = Bun.file(filePath)
			const contentType = contentTypes[ext] || "application/octet-stream"

			return new Response(file, {
				headers: { ...corsHeaders, "Content-Type": contentType },
			})
		}
	}

	return new Response("Not found", {
		status: 404,
		headers: corsHeaders,
	})
}

console.log(`\nDev server starting on http://localhost:${PORT}`)
console.log("Note: No HMR - refresh browser to see changes\n")

const server = Bun.serve({
	port: PORT,
	fetch: handleRequest,
})

// Cleanup on exit
process.on("SIGINT", () => {
	tailwindProcess.kill()
	server.stop()
	process.exit()
})

process.on("SIGTERM", () => {
	tailwindProcess.kill()
	server.stop()
	process.exit()
})
