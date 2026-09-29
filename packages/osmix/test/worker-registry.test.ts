import { Osm } from "@osmix/core";
import { createMockBaseOsm, createMockPatchOsm } from "@osmix/core/mocks";
import { describe, expect, it } from "vitest";

import { OsmixWorker } from "../src/worker";

class TestWorker extends OsmixWorker {
  setOsm(id: string, osm: Osm) {
    this.set(id, osm);
  }

  getOsm(id: string) {
    return this.get(id);
  }
}

function withSpatialIndexes(osm: Osm) {
  osm.buildSpatialIndexes();
  return osm;
}

function withId(osm: Osm, id: string) {
  return new Osm({ ...osm.transferables(), id });
}

function createParallelFootway(
  id: string,
  nodeId: number,
  wayId: number,
  lat: number,
  name: string,
) {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: nodeId, lon: 0, lat });
  osm.nodes.addNode({ id: nodeId + 1, lon: 0.001, lat });
  osm.nodes.buildIndex();
  osm.ways.addWay({
    id: wayId,
    refs: [nodeId, nodeId + 1],
    tags: { highway: "footway", name },
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function createMixedParallelNetwork(
  id: string,
  nodeId: number,
  wayId: number,
  offset: number,
  namePrefix: string,
) {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: nodeId, lon: 0, lat: offset });
  osm.nodes.addNode({ id: nodeId + 1, lon: 0.001, lat: offset });
  osm.nodes.addNode({ id: nodeId + 2, lon: 0, lat: 0.01 + offset });
  osm.nodes.addNode({ id: nodeId + 3, lon: 0.001, lat: 0.01 + offset });
  osm.nodes.buildIndex();
  osm.ways.addWay({
    id: wayId,
    refs: [nodeId, nodeId + 1],
    tags: { highway: "footway", name: `${namePrefix} path` },
  });
  osm.ways.addWay({
    id: wayId + 1,
    refs: [nodeId + 2, nodeId + 3],
    tags: { highway: "residential", name: `${namePrefix} street` },
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("OsmixWorker registries", () => {
  it("stores reserved and ordinary IDs without prototype collisions", () => {
    const worker = new TestWorker();
    const ids = ["__proto__", "constructor", "toString", "ordinary"];

    for (const id of ids) {
      worker.setOsm(id, withId(createMockBaseOsm(), id));
      worker.buildRoutingGraph(id);
    }

    expect(ids.map((id) => worker.has(id))).toEqual([true, true, true, true]);
    expect(ids.map((id) => worker.isReady(id))).toEqual([true, true, true, true]);
    expect(ids.map((id) => worker.hasRoutingGraph(id))).toEqual([true, true, true, true]);
    expect(worker.getOsm("__proto__").id).toBe("__proto__");

    worker.delete("__proto__");

    expect(worker.has("__proto__")).toBe(false);
    expect(worker.hasRoutingGraph("__proto__")).toBe(false);
    expect(worker.has("constructor")).toBe(true);
    expect(worker.has("toString")).toBe(true);
    expect(worker.has("ordinary")).toBe(true);
    expect(() => worker.getOsm("missing")).toThrow("OSM not found for id: missing");
  });

  it("keeps merge plans isolated for reserved IDs", async () => {
    const worker = new TestWorker();
    const registries = [
      ["__proto__", "patch-proto"],
      ["constructor", "patch-constructor"],
      ["toString", "patch-to-string"],
    ] as const;

    for (const [baseId, patchId] of registries) {
      worker.setOsm(baseId, withSpatialIndexes(withId(createMockBaseOsm(), baseId)));
      worker.setOsm(patchId, withSpatialIndexes(withId(createMockPatchOsm(), patchId)));
      worker.planMerge(baseId, patchId, { mergeIdenticalPoints: false });
    }

    for (const [baseId] of registries) {
      const page = worker.getMergePlanPage(baseId, 0, 100);
      expect(page.features.length).toBeGreaterThan(0);
    }

    worker.applyMergePlan("__proto__");

    expect(() => worker.getMergePlanOverview("__proto__")).toThrow("No active merge plan");
    expect(() => worker.getMergePlanOverview("missing")).toThrow("No active merge plan");
    expect(worker.getMergePlanPage("constructor", 0, 100).features.length).toBeGreaterThan(0);
    expect(worker.has("__proto__")).toBe(true);
    expect(worker.has("patch-proto")).toBe(false);
    expect(worker.has("constructor")).toBe(true);
    expect(worker.has("toString")).toBe(true);
  });

  it("connects an imported path with automatic matching without changing the CAR graph", () => {
    const worker = new TestWorker();
    const base = createParallelFootway("walk-base", 1, 10, 0, "Base path");
    const patch = createParallelFootway("walk-patch", 11, 20, 0.000004, "Imported path");
    worker.setOsm(base.id, base);
    worker.setOsm(patch.id, patch);
    const separate = worker.planMerge(base.id, patch.id, { createIntersections: false });
    expect(separate.diagnostics.routing.walk.delta.components).toBe(1);

    const matched = worker.planMerge(base.id, patch.id, {
      createIntersections: false,
      matching: { propertyKeys: ["name"], attachNetwork: true },
    });
    expect(matched.diagnostics.routing.car.delta).toMatchObject({
      routableNodes: 0,
      edges: 0,
      components: 0,
    });
    // The imported path joins the base network instead of adding a component.
    expect(matched.diagnostics.routing.walk.delta.components).toBe(0);
    expect(matched.diagnostics.demoted).toEqual([]);
  });

  it("keeps CAR topology unchanged when copying way properties alongside WALK attachment", () => {
    const worker = new TestWorker();
    const base = createMixedParallelNetwork("mixed-base", 1, 10, 0, "Base");
    const patch = createMixedParallelNetwork("mixed-patch", 11, 20, 0.000004, "Imported");
    worker.setOsm(base.id, base);
    worker.setOsm(patch.id, patch);
    const overview = worker.planMerge(base.id, patch.id, {
      createIntersections: false,
      matching: { propertyKeys: ["name"], attachNetwork: true },
    });
    expect(overview.diagnostics.routing.car.delta.edges).toBe(
      worker.planMerge(base.id, patch.id, { createIntersections: false }).diagnostics.routing.car
        .delta.edges,
    );
  });
});
