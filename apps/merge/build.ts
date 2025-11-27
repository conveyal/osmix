#!/usr/bin/env bun
/**
 * Production build script for @osmix/merge using Bun.
 *
 * This script:
 * 1. Cleans the dist directory
 * 2. Builds CSS with Tailwind CLI
 * 3. Bundles TypeScript/React with Bun
 * 4. Copies static assets (fonts) and generates index.html
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const ROOT = import.meta.dirname
const DIST = join(ROOT, "dist")
const SRC = join(ROOT, "src")

// Clean dist directory
if (existsSync(DIST)) {
	rmSync(DIST, { recursive: true })
}
mkdirSync(DIST, { recursive: true })
mkdirSync(join(DIST, "assets"), { recursive: true })

// Copy font files
console.log("Copying font files...")
const fontsDir = join(ROOT, "../../node_modules/@fontsource-variable/roboto-mono/files")
if (existsSync(fontsDir)) {
	for (const file of readdirSync(fontsDir)) {
		if (file.endsWith(".woff2") && file.includes("latin") && file.includes("normal")) {
			copyFileSync(join(fontsDir, file), join(DIST, "assets", file))
			console.log(`  Copied ${file}`)
		}
	}
}

console.log("Building CSS with Tailwind...")
await $`bunx @tailwindcss/cli -i ${join(SRC, "main.css")} -o ${join(DIST, "assets/main.css")} --minify`

// Fix font URLs in CSS to use relative paths
const cssPath = join(DIST, "assets/main.css")
let cssContent = await Bun.file(cssPath).text()
cssContent = cssContent.replace(
	/@fontsource-variable\/roboto-mono\/files\//g,
	""
)
await Bun.write(cssPath, cssContent)

console.log("Bundling application with Bun...")
const result = await Bun.build({
	entrypoints: [join(SRC, "main.tsx")],
	outdir: join(DIST, "assets"),
	target: "browser",
	format: "esm",
	splitting: true,
	minify: true,
	sourcemap: "linked",
	naming: "[dir]/[name]-[hash].[ext]",
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
	loader: {
		".woff2": "file",
		".woff": "file",
		".ttf": "file",
		".png": "file",
		".svg": "file",
		".jpg": "file",
		".jpeg": "file",
		".gif": "file",
	},
})

if (!result.success) {
	console.error("Build failed:")
	for (const log of result.logs) {
		console.error(log)
	}
	process.exit(1)
}

// Find the main entry point output
const mainOutput = result.outputs.find(
	(o) => o.kind === "entry-point" && o.path.includes("main"),
)

if (!mainOutput) {
	console.error("Could not find main entry point in build outputs")
	process.exit(1)
}

const mainJsPath = mainOutput.path.replace(`${DIST}/`, "")

// Generate index.html
const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Osmix Merge</title>
    <link rel="stylesheet" href="assets/main.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${mainJsPath}"></script>
  </body>
</html>`

await Bun.write(join(DIST, "index.html"), indexHtml)

console.log("Build complete!")
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
