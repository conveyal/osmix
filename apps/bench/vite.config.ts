import path from "node:path"
import react from "@vitejs/plugin-react"
import { preview } from "@vitest/browser-preview"
import { defineConfig } from "vitest/config"

export default defineConfig({
	base: "/",
	plugins: [react()],
	publicDir:
		process.env.NODE_ENV === "development" ? "../../fixtures" : undefined,
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	server: {
		headers: {
			"Cross-Origin-Embedder-Policy": "require-corp",
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Resource-Policy": "same-origin",
		},
	},
	optimizeDeps: {
		exclude: ["@duckdb/duckdb-wasm"],
		esbuildOptions: {
			target: "esnext",
		},
	},
	test: {
		browser: {
			enabled: process.env.CI !== "true",
			provider: preview(),
			instances: [
				{
					browser: "chromium",
				},
			],
		},
	},
})
