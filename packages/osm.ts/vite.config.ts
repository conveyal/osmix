import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	build: {
		lib: {
			entry: {
				index: resolve(__dirname, "src/index.ts"),
				read: resolve(__dirname, "src/read.ts"),
				write: resolve(__dirname, "src/write.ts"),
			},
			name: "osm.ts",
		},
	},
	test: {
		benchmark: {
			include: ["**/**.bench.ts"],
		},
	},
})
