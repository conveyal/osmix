import { defineConfig } from "vite"

export default defineConfig({
	base: "/",
	publicDir:
		process.env.NODE_ENV === "development" ? "../../fixtures" : undefined,
	server: {
		headers: {
			"Cross-Origin-Embedder-Policy": "require-corp",
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Resource-Policy": "same-origin",
		},
	},
})
