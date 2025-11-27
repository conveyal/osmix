#!/usr/bin/env bun
/**
 * Bun fullstack server for @osmix/merge.
 *
 * Development: bun run serve.ts
 * Production:  NODE_ENV=production bun run serve.ts
 *
 * Features:
 * - Hot Module Replacement (HMR) in development
 * - Automatic TypeScript/TSX bundling
 * - Tailwind CSS v4 processing via bun-plugin-tailwind
 * - CORS headers for SharedArrayBuffer support
 */

import tailwind from "bun-plugin-tailwind"

// Register Tailwind plugin for the bundler
Bun.plugin(tailwind)

import homepage from "./index.html"

const isProduction = process.env.NODE_ENV === "production"
const port = Number(process.env.PORT) || 5173

const _server = Bun.serve({
	port,
	development: !isProduction,

	// Route to the bundled app
	routes: {
		"/": homepage,
	},

	// Handle additional requests (fixtures, API, etc.)
	async fetch(req) {
		const url = new URL(req.url)

		// Add CORS headers to all responses
		const headers = {
			"Cross-Origin-Embedder-Policy": "require-corp",
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Resource-Policy": "same-origin",
		}

		// Serve fixtures directory in development
		if (!isProduction) {
			const fixturePath = `${import.meta.dir}/../../fixtures${url.pathname}`
			const file = Bun.file(fixturePath)
			if (await file.exists()) {
				return new Response(file, { headers })
			}
		}

		return new Response("Not found", { status: 404, headers })
	},
})

console.log(`
🥟 Osmix Merge
   URL: http://localhost:${port}
   Mode: ${isProduction ? "production" : "development"}
   ${!isProduction ? "HMR: enabled" : ""}
`)
