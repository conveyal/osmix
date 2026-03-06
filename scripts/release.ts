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

const packagesRoot = resolve(import.meta.dir, "../packages")

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
			types: "./dist/index.d.ts",
		}
	}

	throw Error(`Cannot rewrite package.json for ${pkgJson.name}`)
}

function serializePackageJson(pkgJson: PackageJson): string {
	return `${JSON.stringify(pkgJson, null, "\t")}\n`
}

async function withPublishedManifest<T>(
	{ manifest, packageJsonPath }: WorkspacePackage,
	run: () => Promise<T>,
): Promise<T> {
	try {
		await Bun.write(
			packageJsonPath,
			serializePackageJson(rewritePkgJsonForDist(manifest)),
		)
		return await run()
	} finally {
		await Bun.write(packageJsonPath, serializePackageJson(manifest))
	}
}

async function publishPackage(
	workspacePackage: WorkspacePackage,
): Promise<void> {
	const {
		dir,
		manifest: { name, version },
	} = workspacePackage

	$.cwd(dir)

	console.log(`- Publishing ${name}@${version}`)
	await $`bun run build`

	await withPublishedManifest(workspacePackage, async () => {
		const tarballToPublish = (await $`bun pm pack --quiet`.text()).trim()
		if (!tarballToPublish)
			throw Error(`No tarball generated for ${name}@${version}`)

		await $`npm publish ./${tarballToPublish} --access=public --provenance=true`
		await rm(tarballToPublish, { force: true })
	})
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

		await publishPackage({ dir, packageJsonPath, manifest })
		publishedCount++
	}

	if (publishedCount === 0) {
		console.log("No new packages published.")
	} else {
		console.log(`Published ${publishedCount} package(s)`)
	}
}

await run()
