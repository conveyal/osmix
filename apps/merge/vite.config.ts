import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  publicDir: process.env.NODE_ENV === "development" ? "../../fixtures" : undefined,
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  },
  optimizeDeps: {
    // maplibre-gl 6 loads its worker from a sibling module that the dep optimizer cannot follow.
    exclude: ["maplibre-gl"],
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
