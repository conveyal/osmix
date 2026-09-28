import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "plan-review.spec.ts",
    "merge-base-loading.spec.ts",
    "monaco-merge-patch.spec.ts",
    "inspect.spec.ts",
    "extract.spec.ts",
    "navigation.spec.ts",
    "worker-runtime.spec.ts",
  ],
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "vite --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/e2e/worker-harness.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "app-integration",
      testMatch: [
        "merge-base-loading.spec.ts",
        "monaco-merge-patch.spec.ts",
        "inspect.spec.ts",
        "extract.spec.ts",
        "navigation.spec.ts",
      ],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Keep even the lightweight browser harness off the runner while the real
      // Merge journey is parsing PBFs and rendering MapLibre.
      name: "plan-review",
      dependencies: ["app-integration"],
      testMatch: ["plan-review.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Worker restart and multi-worker tests run last so their nested workers
      // cannot starve either UI project on small CI runners.
      name: "worker-runtime",
      dependencies: ["plan-review"],
      testMatch: ["worker-runtime.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
