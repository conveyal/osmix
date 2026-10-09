import path from "node:path";

import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/",
  plugins: [react()],
  publicDir: process.env.NODE_ENV === "development" ? "../../fixtures" : undefined,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
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
  optimizeDeps: {
    exclude: ["@duckdb/duckdb-wasm"],
    rolldownOptions: {
      transform: { target: "esnext" },
    },
  },
  test: {
    browser: {
      enabled: process.env.CI !== "true",
      provider: playwright(),
      headless: true,
      instances: [
        {
          browser: "chromium",
        },
      ],
    },
  },
});
