import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	build: {
		lib: {
			entry: {
				index: resolve(__dirname, "lib/index.ts"),
				read: resolve(__dirname, "lib/read.ts"),
				write: resolve(__dirname, "lib/write.ts"),
			},
			name: "osm.ts",
		},
	},
})
