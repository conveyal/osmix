import { readdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { $ } from "bun"

/**
 *  For each package in the repo:
 *  1. Check if the current version is already published to npm, if it is, skip.
 *  2. Build the package.
 *  3. Convert the package.json to use `dist/index.js` as the main entry point.
 *  4. Pack the package.
 *  5. Publish the package to npm.
 */

interface PackageJson {
	name: string
	version: string
	private?: boolean
	main?: string
	types?: string
	dependencies?: Record<string, string>
	exports?: Record<string, string | { types: string; default: string }>
}

interface WorkspacePackage {
	dir: string
	packageJsonPath: string
	manifest: PackageJson
}

const repoRoot = resolve(import.meta.dir, "..")
const packagesRoot = join(repoRoot, "packages")

async function isVersionPublished(
	name: string,
	version: string,
): Promise<boolean> {
	try {
		const output =
			await $`npm view ${`${name}@${version}`} version --json`.quiet()
		return output.text().trim() !== ""
	} catch {
		return false
	}
}

function rewritePkgJsonForDist(pkgJson: PackageJson): PackageJson {
	if (pkgJson.name === "@osmix/shared") {
		return {
			...pkgJson,
			exports: {
				...pkgJson.exports,
				"./*": {
					default: "./dist/*.js",
					types: "./dist/*.d.ts",
				},
			},
		}
	}
	if (pkgJson.main) {
		return {
			...pkgJson,
			main: "./dist/index.js",
			types: "./dist/index.d.ts"
		}
	}
	throw Error(`Cannot rewrite package.json for ${pkgJson.name}`)
}

async function publishPackage({
	dir,
	manifest,
	packageJsonPath,
}: WorkspacePackage): Promise<boolean> {
	const { name, version } = manifest

	$.cwd(dir)

	console.log(`- Publishing ${name}@${version}`)
	await $`bun run build`

	try {
		// Rewrite the package.json to use the built entry point.
		await Bun.write(
			packageJsonPath,
			JSON.stringify(rewritePkgJsonForDist(manifest), null, "\t"),
		)

		const tarballToPublish = await $`bun pm pack --quiet`.text().trim()
		if (!tarballToPublish)
			throw Error(`No tarball generated for ${name}@${version}`)

		await $`npm publish ./${tarballToPublish} --access=public --provenance=true`

		// Clean up the tarball.
		await rm(tarballToPublish, { force: true })

	} finally {
		// Revert the package.json to the original.
		await Bun.write(packageJsonPath, JSON.stringify(manifest, null, "\t"))
	}
	return true
}

async function run(): Promise<void> {
	const entries = await readdir(packagesRoot, { withFileTypes: true })
	let publishedCount = 0

	for (const entry of entries) {
		if (!entry.isDirectory()) continue

		const dir = join(packagesRoot, entry.name)
		const packageJsonPath = join(dir, "package.json")
		const manifest = (await Bun.file(packageJsonPath).json()) as PackageJson
		if (!manifest.name || !manifest.version || manifest.private) continue
		const alreadyPublished = await isVersionPublished(
			manifest.name,
			manifest.version,
		)
		if (alreadyPublished) {
			console.log(
				`- Skipping ${manifest.name}@${manifest.version}; already published`,
			)
			continue
		}
		const published = await publishPackage({ dir, packageJsonPath, manifest })
		if (published) publishedCount++
	}

	if (publishedCount === 0) {
		console.log("No new packages published.")
	} else {
		console.log(`Published ${publishedCount} package(s)`)
	}
}

await run()
