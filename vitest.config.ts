import { defineConfig } from "vitest/config";

const appProjects = ["apps/app", "apps/bench/vite.config.ts"] as const;

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    projects: ["packages/*", ...(process.env["VITEST_INCLUDE_APPS"] === "1" ? appProjects : [])],
  },
});
