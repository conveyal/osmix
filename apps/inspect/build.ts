#!/usr/bin/env bun
/**
 * Production build script for @osmix/inspect.
 *
 * Outputs static files to dist/ directory.
 */

import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import tailwind from "bun-plugin-tailwind"

const ROOT = import.meta.dirname
const DIST = join(ROOT, "dist")

// Clean dist directory
if (existsSync(DIST)) {
	rmSync(DIST, { recursive: true })
}

console.log("Building @osmix/inspect...")

const result = await Bun.build({
	entrypoints: [join(ROOT, "index.html")],
	outdir: DIST,
	target: "browser",
	minify: true,
	sourcemap: "linked",
	splitting: true,
	plugins: [tailwind],
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
})

if (!result.success) {
	console.error("Build failed:")
	for (const log of result.logs) {
		console.error(log)
	}
	process.exit(1)
}

console.log("\nBuild complete!")
console.log(`Output: ${DIST}`)

for (const output of result.outputs) {
	const size = output.size
	const sizeStr =
		size > 1024 * 1024
			? `${(size / 1024 / 1024).toFixed(2)} MB`
			: size > 1024
				? `${(size / 1024).toFixed(2)} KB`
				: `${size} B`
	console.log(`  ${output.path.replace(`${DIST}/`, "")} (${sizeStr})`)
}
