import { describe, expect, it } from "bun:test"
import { createMockBaseOsm, createMockPatchOsm } from "@osmix/core"
import { OsmChangeset } from "../src/changeset"
import { generateOscChanges } from "../src/osc"

describe("augmented diffs", () => {
	it("should capture oldEntity for modify operations", () => {
		const base = createMockBaseOsm()
		const patch = createMockPatchOsm()

		const changeset = new OsmChangeset(base)
		changeset.generateDirectChanges(patch)

		// Way 1 is modified (exists in both base and patch with different tags)
		const wayChange = changeset.wayChanges[1]
		if (!wayChange) throw new Error("wayChange is undefined")
		expect(wayChange.changeType).toBe("modify")
		expect(wayChange.entity.tags).toEqual({
			highway: "primary",
			version: "2",
		})
		expect(wayChange.oldEntity).toBeDefined()
		expect(wayChange.oldEntity?.tags).toEqual({
			highway: "primary",
		})
	})

	it("should capture oldEntity for delete operations", () => {
		const base = createMockBaseOsm()
		const changeset = new OsmChangeset(base)

		// Delete a node
		const nodeToDelete = base.nodes.getById(0)!
		changeset.delete(nodeToDelete)

		const nodeChange = changeset.nodeChanges[0]
		if (!nodeChange) throw new Error("nodeChange is undefined")
		expect(nodeChange.changeType).toBe("delete")
		expect(nodeChange.oldEntity).toBeDefined()
		expect(nodeChange.oldEntity).toEqual(nodeToDelete)
	})

	it("should not have oldEntity for create operations", () => {
		const base = createMockBaseOsm()
		const patch = createMockPatchOsm()

		const changeset = new OsmChangeset(base)
		changeset.generateDirectChanges(patch)

		// Way 2 is created (only exists in patch)
		const wayChange = changeset.wayChanges[2]
		if (!wayChange) throw new Error("wayChange is undefined")
		expect(wayChange.changeType).toBe("create")
		expect(wayChange.oldEntity).toBeUndefined()
	})

	it("should preserve oldEntity when modify is called multiple times", () => {
		const base = createMockBaseOsm()
		const changeset = new OsmChangeset(base)

		// First modification
		changeset.modify("way", 1, (way) => ({
			...way,
			tags: { ...way.tags, surface: "asphalt" },
		}))

		const firstChange = changeset.wayChanges[1]
		if (!firstChange) throw new Error("firstChange is undefined")
		expect(firstChange.oldEntity?.tags).toEqual({ highway: "primary" })
		expect(firstChange.entity.tags).toEqual({
			highway: "primary",
			surface: "asphalt",
		})

		// Second modification - oldEntity should still be the original
		changeset.modify("way", 1, (way) => ({
			...way,
			tags: { ...way.tags, lanes: "2" },
		}))

		const secondChange = changeset.wayChanges[1]
		if (!secondChange) throw new Error("secondChange is undefined")
		expect(secondChange.oldEntity?.tags).toEqual({ highway: "primary" })
		expect(secondChange.entity.tags).toEqual({
			highway: "primary",
			surface: "asphalt",
			lanes: "2",
		})
	})

	describe("generateOscChanges", () => {
		it("should generate standard OSC format by default", () => {
			const base = createMockBaseOsm()
			const patch = createMockPatchOsm()

			const changeset = new OsmChangeset(base)
			changeset.generateDirectChanges(patch)

			const osc = generateOscChanges(changeset)

			// Check that modify section does not contain old/new wrappers
			expect(osc).toContain("<modify>")
			expect(osc).not.toContain("<old>")
			expect(osc).not.toContain("<new>")
			// Should still contain the modified elements directly
			expect(osc).toContain("<way")
		})

		it("should generate augmented diffs with old/new for modifications", () => {
			const base = createMockBaseOsm()
			const changeset = new OsmChangeset(base)

			// Modify node 0 to add a tag
			changeset.modify("node", 0, (node) => ({
				...node,
				tags: { ...node.tags, amenity: "cafe" },
			}))

			const osc = generateOscChanges(changeset, { augmented: true })

			// Should contain old and new versions
			expect(osc).toContain("<old>")
			expect(osc).toContain("<new>")
			// New version should have the new tag
			expect(osc).toContain('k="amenity"')
		})

		it("should generate augmented diffs with old for deletions", () => {
			const base = createMockBaseOsm()
			const changeset = new OsmChangeset(base)

			// Delete node 0
			const nodeToDelete = base.nodes.getById(0)!
			changeset.delete(nodeToDelete)

			const osc = generateOscChanges(changeset, { augmented: true })

			// Delete section should contain the old element
			expect(osc).toContain("<delete>")
			expect(osc).toContain("<old>")
			expect(osc).toContain(`id="${nodeToDelete.id}"`)
		})

		it("should not generate augmented format when augmented: false", () => {
			const base = createMockBaseOsm()
			const patch = createMockPatchOsm()

			const changeset = new OsmChangeset(base)
			changeset.generateDirectChanges(patch)

			const osc = generateOscChanges(changeset, { augmented: false })

			// Should not contain old/new wrappers
			expect(osc).not.toContain("<old>")
			expect(osc).not.toContain("<new>")
			// Should still contain the modified elements directly
			expect(osc).toContain("<modify>")
			expect(osc).toContain("<way")
		})

		it("should generate standard delete format when augmented: false", () => {
			const base = createMockBaseOsm()
			const changeset = new OsmChangeset(base)

			// Delete node 0
			const nodeToDelete = base.nodes.getById(0)!
			changeset.delete(nodeToDelete)

			const osc = generateOscChanges(changeset, { augmented: false })

			// Delete should use minimal format
			expect(osc).toContain(`<node id="${nodeToDelete.id}" />`)
			expect(osc).not.toContain("<old>")
		})
	})
})
