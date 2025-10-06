import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, "../../../../fixtures/monaco.pbf")

test.describe("Inspect page", () => {
	test("loads fixture and exposes inspector controls", async ({ page }) => {
		await page.goto("/inspect")

		await page.getByTestId("inspect-file-input").setInputFiles(fixturePath)
		await expect(page.getByText(/FILE: monaco\.pbf/)).toBeVisible()

		await expect(
			page.getByRole("button", { name: /Find duplicate nodes and ways/ }),
		).toBeVisible()

		await expect(page.getByRole("link", { name: "Inspect" })).toHaveAttribute(
			"aria-current",
			"page",
		)
	})
})
