import { describe, expect, it } from "vitest";

import {
  applyChangesetToOsm,
  generateChangeset,
  Osm,
  type OsmChanges,
  OsmChangeset,
  type OsmChangesetInputIdentity,
  type OsmChangesetRestoreContext,
  type OsmChangesetValidationContext,
  OsmixRemote,
} from "../src/index";

function inheritedGradeInputs() {
  const base = new Osm({ id: "serialization-base" });
  base.buildIndexes();
  base.buildSpatialIndexes();
  const patch = new Osm({ id: "serialization-patch" });
  for (const node of [
    { id: 1, lon: 0, lat: 0 },
    { id: 2, lon: 0.001, lat: 0 },
    { id: 3, lon: 0.002, lat: 0 },
    { id: 4, lon: 0.001, lat: 0.001 },
  ]) {
    patch.nodes.addNode(node);
  }
  patch.nodes.buildIndex();
  patch.ways.addWay({
    id: 10,
    refs: [1, 2, 3],
    tags: { highway: "footway", name: "Surface path" },
  });
  patch.ways.addWay({
    id: 20,
    refs: [2, 4],
    tags: { highway: "footway", bridge: "yes", layer: "1", name: "Bridge" },
  });
  patch.buildIndexes();
  patch.buildSpatialIndexes();
  return { base, patch };
}

function entities(osm: Osm) {
  return {
    nodes: [...osm.nodes.sorted()],
    ways: [...osm.ways.sorted()],
    relations: [...osm.relations.sorted()],
  };
}

class RecoveryRemote extends OsmixRemote {
  async restartForTest(ids: string[]) {
    const worker = this.getWorker();
    for (const id of ids) await worker.delete(id);
    await this.restorePoolWorker(worker, 0, 1);
  }
}

describe("changeset validation through the public facade", () => {
  it("restores a JSON changeset with its verified inherited patch grade context", () => {
    const { base, patch } = inheritedGradeInputs();
    const generated = generateChangeset(base, patch, { directMerge: true }, () => {});
    const expected = entities(applyChangesetToOsm(generated));
    const serialized = generated.toJSON();
    const json: OsmChanges = JSON.parse(JSON.stringify(generated));
    expect(json).toEqual(serialized);
    const validation: OsmChangesetValidationContext | undefined = json.validationContext;
    if (!validation) throw Error("Expected serialized validation context");
    const baseIdentity: OsmChangesetInputIdentity = validation.base;
    expect(baseIdentity.id).toBe(base.id);
    expect(baseIdentity.contentHash).toBe(base.contentHash());
    expect(validation.patches.map((identity) => identity.id)).toEqual([patch.id]);
    const context: OsmChangesetRestoreContext = { patches: [patch] };

    const restored = OsmChangeset.fromJson(base, json, context);

    expect(entities(applyChangesetToOsm(restored))).toEqual(expected);
  });

  it("retains inherited patch grade context when worker recovery regenerates a preview", async () => {
    const { base, patch } = inheritedGradeInputs();
    const expected = entities(
      applyChangesetToOsm(generateChangeset(base, patch, { directMerge: true }, () => {})),
    );
    using remote = new RecoveryRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    await remote.generateChangeset(base.id, patch.id, { directMerge: true });
    const preview = await remote.getChangesetPage(base.id, 0, 100);

    await remote.restartForTest([base.id, patch.id]);

    expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(preview);
    await remote.applyChangesAndReplace(base.id);
    expect(entities(await remote.get(base.id))).toEqual(expected);
  });
});
