import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 120_000,
	expect: {
		timeout: 10_000,
	},
	fullyParallel: true,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: "http://127.0.0.1:4173",
		screenshot: "only-on-failure",
		trace: "on-first-retry",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: "bun run dev --host 127.0.0.1 --port 4173",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		url: "http://127.0.0.1:4173",
	},
})
