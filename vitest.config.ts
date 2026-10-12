import { defineConfig } from "vitest/config";

// `apps/bench` runs in a browser and is left out; run it with `pnpm -F @osmix/bench test`.
export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/app",
      "apps/shortbread",
      "apps/vt-server",
      { test: { name: "scripts", include: ["scripts/**/*.test.ts"] } },
    ],
  },
});
