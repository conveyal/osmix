import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearDatasetNames, nameDataset, withDatasetNames } from "../src/lib/dataset-names.ts";
import { createThrottledProgressLogger } from "../src/lib/progress-log.ts";
import { osmFileInfoAtomFamily } from "../src/state/osm.ts";
import { createTaskStore, isTaskNode } from "../src/state/tasks.ts";

const BASE = "d2d0bb3b2e1edba249473f3d67bf6909318b3c7fa9b4f23501a2b63f11ee58fc";
const PATCH = "1f24d3e4e4762408187e3bc1611f30fbca7e868fb0541707249a15a34219cd40";

describe("dataset names in activity text", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    clearDatasetNames();
    vi.restoreAllMocks();
  });

  it("replaces every known ID and leaves unknown ones", () => {
    nameDataset(BASE, "monaco.pbf");
    expect(withDatasetNames(`Planning direct changes from ${PATCH} to ${BASE}...`)).toBe(
      `Planning direct changes from ${PATCH} to monaco.pbf...`,
    );
    nameDataset(PATCH, "monaco-merge-patch.geojson");
    expect(withDatasetNames(`${PATCH} and ${PATCH}`)).toBe(
      "monaco-merge-patch.geojson and monaco-merge-patch.geojson",
    );
  });

  it("names a dataset when its file info is set", () => {
    const store = createStore();
    store.set(osmFileInfoAtomFamily("base"), {
      fileHash: BASE,
      fileName: "monaco.pbf",
      fileSize: 1,
    });
    expect(store.get(osmFileInfoAtomFamily("base"))?.fileName).toBe("monaco.pbf");
    expect(withDatasetNames(`Finished loading ${BASE} PBF data into Osmix.`)).toBe(
      "Finished loading monaco.pbf PBF data into Osmix.",
    );
  });

  it("records worker progress, live details and failures with names", () => {
    nameDataset(BASE, "monaco.pbf");
    const tasks = createTaskStore();
    const task = tasks.start("Plan merge");
    const log = createThrottledProgressLogger(tasks, 0);
    log({ msg: `Creating intersections from ${BASE}...`, level: "info", timestamp: 0 });
    log({ msg: `Checked ${BASE}`, level: "info", timestamp: 0, throttle: true });
    const entry = tasks.getSnapshot().entries.at(-1);
    if (!entry || !isTaskNode(entry)) throw Error("Expected a task");
    expect(entry.children).toMatchObject([
      { message: "Creating intersections from monaco.pbf..." },
    ]);
    expect(entry.detail).toBe("Checked monaco.pbf");
    task.fail(Error(`Build indexes for ${BASE} before planning a merge`));
    const failed = tasks.getSnapshot().entries.at(-1);
    expect(failed && isTaskNode(failed) ? failed.summary : null).toBe(
      "Build indexes for monaco.pbf before planning a merge",
    );
  });
});
