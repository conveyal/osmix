import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/",
  plugins: [
    react({
      compiler: true,
    }),
    tailwindcss(),
  ],
  publicDir: process.env.NODE_ENV === "development" ? "../../fixtures" : undefined,
  optimizeDeps: {
    // Only the app worker imports these, and Vite's dependency scan does not follow workers. Left
    // to discovery, the dev server finds them on first load and reloads the page mid-render.
    include: ["@osmix/app-core > hash-wasm", "@osmix/app-core > idb"],
  },
  server: {
    host: process.env.HOST,
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    strictPort: process.env.PORT !== undefined,
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
