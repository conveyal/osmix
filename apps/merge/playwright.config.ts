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
      name: "merge-integration",
      testMatch: ["merge-base-loading.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Keep even the lightweight browser harness off the runner while the real
      // Merge journey is parsing PBFs and rendering MapLibre.
      name: "guidance",
      dependencies: ["merge-integration"],
      testMatch: ["guidance.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Worker restart and multi-worker tests run last so their nested workers
      // cannot starve either UI project on small CI runners.
      name: "worker-runtime",
      dependencies: ["guidance"],
      testMatch: ["worker-runtime.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
