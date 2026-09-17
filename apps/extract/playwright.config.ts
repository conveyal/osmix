import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:4175",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm dev:app --host 127.0.0.1 --port 4175",
    url: "http://127.0.0.1:4175/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "extract", use: { ...devices["Desktop Chrome"] } }],
});
