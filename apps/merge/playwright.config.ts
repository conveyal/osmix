import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "worker-runtime.spec.ts",
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
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
