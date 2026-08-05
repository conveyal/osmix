import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["guidance.spec.ts", "merge-base-loading.spec.ts", "worker-runtime.spec.ts"],
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    command: "pnpm dev:app --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/e2e/worker-harness.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "merge-ui",
      testMatch: ["guidance.spec.ts", "merge-base-loading.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Worker restart and multi-worker tests deliberately run after the UI
      // tests so they cannot starve MapLibre or PBF parsing on small CI runners.
      name: "worker-runtime",
      dependencies: ["merge-ui"],
      testMatch: ["worker-runtime.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
