import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(
	__dirname,
	"../../../../fixtures/monaco-250101.osm.pbf",
)

test.describe("Merge page", () => {
	test("loads fixture files and exposes file metadata", async ({ page }) => {
		await page.goto("/")

		await page.getByTestId("merge-base-file-input").setInputFiles(fixturePath)
		await expect(page.getByText(/FILE: monaco-250101\.osm\.pbf/)).toBeVisible()

		await page.getByTestId("merge-patch-file-input").setInputFiles(fixturePath)
		await expect(page.getByText("PATCH OSM PBF")).toBeVisible()

		await expect(page.getByRole("link", { name: "Merge" })).toHaveAttribute(
			"aria-current",
			"page",
		)
	})
})
