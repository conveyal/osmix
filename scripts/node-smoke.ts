import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

interface PackageJson {
	name: string
	version: string
	private?: boolean
	main?: string
	types?: string
	exports?: Record<string, string | { types: string; default: string }>
}

interface WorkspacePackage {
	dir: string
	manifest: PackageJson
}

const repoRoot = resolve(import.meta.dir, "..")
const packagesRoot = join(repoRoot, "packages")
const smokeDependencies = ["@osmix/core", "osmix"] as const
const consumerSource = `import assert from "node:assert/strict"
import { Osm } from "@osmix/core"
import { createRemote, fromPbf } from "osmix"

const osm = new Osm({ id: "smoke" })
assert.equal(osm.id, "smoke")
assert.equal(typeof fromPbf, "function")
assert.equal(typeof createRemote, "function")

console.log("Node/npm smoke test passed")
`

function run(
	command: string,
	args: string[],
	cwd: string,
	options: { captureOutput?: boolean } = {},
): string {
	const { captureOutput = false } = options
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
	})

	if (result.status !== 0) {
		throw Error(`Command failed: ${command} ${args.join(" ")}`)
	}

	return captureOutput ? result.stdout.trim() : ""
}

function getPackageJsonPath(dir: string): string {
	return join(dir, "package.json")
}

async function listWorkspacePackages(): Promise<WorkspacePackage[]> {
	const entries = await readdir(packagesRoot, { withFileTypes: true })
	const workspacePackages = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map(async (entry) => {
				const dir = join(packagesRoot, entry.name)
				const manifest = (await Bun.file(
					getPackageJsonPath(dir),
				).json()) as PackageJson

				if (!manifest.name || !manifest.version || manifest.private) {
					return null
				}

				return { dir, manifest }
			}),
	)

	return workspacePackages.filter((pkg) => pkg !== null)
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
	{ dir, manifest }: WorkspacePackage,
	callback: () => Promise<T>,
): Promise<T> {
	const packageJsonPath = getPackageJsonPath(dir)

	await Bun.write(
		packageJsonPath,
		serializePackageJson(rewritePkgJsonForDist(manifest)),
	)

	try {
		return await callback()
	} finally {
		await Bun.write(packageJsonPath, serializePackageJson(manifest))
	}
}

async function packWorkspacePackage(
	workspacePackage: WorkspacePackage,
	tarballDir: string,
): Promise<[string, string]> {
	const tarballName = await withPublishedManifest(
		workspacePackage,
		async () => {
			const packedTarball = run(
				"bun",
				["pm", "pack", "--quiet"],
				workspacePackage.dir,
				{ captureOutput: true },
			)

			if (!packedTarball) {
				throw Error(
					`No tarball generated for ${workspacePackage.manifest.name}@${workspacePackage.manifest.version}`,
				)
			}

			return packedTarball
		},
	)

	const tarballPath = join(tarballDir, tarballName)
	await rename(join(workspacePackage.dir, tarballName), tarballPath)

	return [workspacePackage.manifest.name, `file:${tarballPath}`]
}

function pickOverrides(
	overrides: Record<string, string>,
	names: readonly string[],
): Record<string, string> {
	return Object.fromEntries(
		names.map((name) => {
			const override = overrides[name]

			if (!override) {
				throw Error(`Missing override for ${name}`)
			}

			return [name, override]
		}),
	)
}

async function writeConsumerApp(
	consumerDir: string,
	overrides: Record<string, string>,
): Promise<void> {
	await mkdir(consumerDir, { recursive: true })

	await Bun.write(join(consumerDir, "index.mjs"), consumerSource)
	await Bun.write(
		join(consumerDir, "package.json"),
		JSON.stringify(
			{
				name: "osmix-node-smoke-consumer",
				private: true,
				type: "module",
				packageManager: "npm@11.6.2",
				dependencies: pickOverrides(overrides, smokeDependencies),
				overrides,
			},
			null,
			2,
		),
	)
}

async function main(): Promise<void> {
	const workspacePackages = await listWorkspacePackages()
	const tempRoot = await mkdtemp(join(tmpdir(), "osmix-node-smoke-"))

	try {
		console.log("Building workspace packages for npm smoke test...")
		run("bun", ["--filter", "./packages/**", "build"], repoRoot)

		const tarballDir = join(tempRoot, "tarballs")
		await mkdir(tarballDir, { recursive: true })

		const overrides: Record<string, string> = {}
		for (const workspacePackage of workspacePackages) {
			const [name, override] = await packWorkspacePackage(
				workspacePackage,
				tarballDir,
			)
			overrides[name] = override
		}

		const consumerDir = join(tempRoot, "consumer")
		await writeConsumerApp(consumerDir, overrides)

		console.log("Installing local tarballs into npm consumer app...")
		run("npm", ["install", "--no-fund", "--no-audit"], consumerDir)

		console.log("Running Node.js import smoke test...")
		run("node", ["./index.mjs"], consumerDir)
	} finally {
		await rm(tempRoot, { recursive: true, force: true })
	}
}

await main()
