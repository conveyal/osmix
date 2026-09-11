import { describe, expect, it } from "vitest";

import {
  discoverConflationCandidates,
  fromPbf,
  merge,
  Osm,
  Router,
  RoutingGraph,
  toPbfBuffer,
} from "../src/index";

type Direction = "forward" | "reverse" | "both";

interface DirectionCase {
  name: string;
  baseValue?: string;
  patchValue?: string;
  baseDirection: Direction;
  patchDirection: Direction;
  roundabout?: boolean;
  patchReversed?: boolean;
  compatible: boolean;
}

const directionCases: DirectionCase[] = [
  {
    name: "yes and true",
    baseValue: "yes",
    patchValue: "true",
    baseDirection: "forward",
    patchDirection: "forward",
    compatible: true,
  },
  {
    name: "true and 1",
    baseValue: "true",
    patchValue: "1",
    baseDirection: "forward",
    patchDirection: "forward",
    compatible: true,
  },
  {
    name: "1 and yes",
    baseValue: "1",
    patchValue: "yes",
    baseDirection: "forward",
    patchDirection: "forward",
    compatible: true,
  },
  {
    name: "no and false",
    baseValue: "no",
    patchValue: "false",
    baseDirection: "both",
    patchDirection: "both",
    compatible: true,
  },
  {
    name: "false and 0",
    baseValue: "false",
    patchValue: "0",
    baseDirection: "both",
    patchDirection: "both",
    compatible: true,
  },
  {
    name: "0 and no",
    baseValue: "0",
    patchValue: "no",
    baseDirection: "both",
    patchDirection: "both",
    compatible: true,
  },
  {
    name: "reverse and -1",
    baseValue: "reverse",
    patchValue: "-1",
    baseDirection: "reverse",
    patchDirection: "reverse",
    compatible: true,
  },
  {
    name: "-1 and reverse",
    baseValue: "-1",
    patchValue: "reverse",
    baseDirection: "reverse",
    patchDirection: "reverse",
    compatible: true,
  },
  {
    name: "implicit ordinary and no",
    patchValue: "no",
    baseDirection: "both",
    patchDirection: "both",
    compatible: true,
  },
  {
    name: "implicit roundabout and yes",
    patchValue: "yes",
    baseDirection: "forward",
    patchDirection: "forward",
    roundabout: true,
    compatible: true,
  },
  {
    name: "roundabout 0 and no",
    baseValue: "0",
    patchValue: "no",
    baseDirection: "both",
    patchDirection: "both",
    roundabout: true,
    compatible: true,
  },
  {
    name: "roundabout false and no",
    baseValue: "false",
    patchValue: "no",
    baseDirection: "both",
    patchDirection: "both",
    roundabout: true,
    compatible: true,
  },
  {
    name: "roundabout 0 and yes",
    baseValue: "0",
    patchValue: "yes",
    baseDirection: "both",
    patchDirection: "forward",
    roundabout: true,
    compatible: false,
  },
  {
    name: "roundabout false and yes",
    baseValue: "false",
    patchValue: "yes",
    baseDirection: "both",
    patchDirection: "forward",
    roundabout: true,
    compatible: false,
  },
  {
    name: "opposite directions on matching references",
    baseValue: "yes",
    patchValue: "reverse",
    baseDirection: "forward",
    patchDirection: "reverse",
    compatible: false,
  },
  {
    name: "equivalent directions on reversed references",
    baseValue: "yes",
    patchValue: "-1",
    baseDirection: "forward",
    patchDirection: "forward",
    patchReversed: true,
    compatible: true,
  },
  {
    name: "unsupported ordinary reversible values",
    baseValue: "reversible",
    patchValue: "reversible",
    baseDirection: "both",
    patchDirection: "both",
    compatible: false,
  },
  {
    name: "unsupported roundabout alternating values",
    baseValue: "alternating",
    patchValue: "alternating",
    baseDirection: "forward",
    patchDirection: "forward",
    roundabout: true,
    compatible: false,
  },
];

function createWay(
  id: string,
  nodeId: number,
  wayId: number,
  value: string | undefined,
  roundabout: boolean,
  reversed: boolean,
  latitude: number,
) {
  const osm = new Osm({ id });
  for (let offset = 0; offset < 3; offset++) {
    osm.nodes.addNode({ id: nodeId + offset, lon: offset * 0.0005, lat: latitude });
  }
  osm.nodes.buildIndex();
  // Use an arc so a full roundabout loop cannot conceal forbidden reverse travel.
  const refs = [nodeId, nodeId + 1, nodeId + 2];
  osm.ways.addWay({
    id: wayId,
    refs: reversed ? refs.toReversed() : refs,
    tags: {
      highway: "residential",
      name: id,
      ...(value === undefined ? {} : { oneway: value }),
      ...(roundabout ? { junction: "roundabout" } : {}),
    },
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function expectDirections(
  osm: Osm,
  ways: { nodeId: number; wayId: number; direction: Direction }[],
) {
  const graph = new RoutingGraph(osm);
  const router = new Router(osm, graph);
  const expectedEdges: string[] = [];
  for (const { nodeId, wayId, direction } of ways) {
    for (let offset = 0; offset < 2; offset++) {
      const left = nodeId + offset;
      const right = left + 1;
      if (direction !== "reverse") expectedEdges.push(`${wayId}:${left}->${right}`);
      if (direction !== "forward") expectedEdges.push(`${wayId}:${right}->${left}`);
    }
    const leftIndex = osm.nodes.ids.getIndexFromId(nodeId);
    const rightIndex = osm.nodes.ids.getIndexFromId(nodeId + 2);
    for (const algorithm of ["astar", "dijkstra"] as const) {
      const forward = router.route(leftIndex, rightIndex, { algorithm });
      const reverse = router.route(rightIndex, leftIndex, { algorithm });
      expect(forward?.map((segment) => osm.nodes.ids.at(segment.nodeIndex)) ?? null).toEqual(
        direction === "reverse" ? null : [nodeId, nodeId + 1, nodeId + 2],
      );
      expect(reverse?.map((segment) => osm.nodes.ids.at(segment.nodeIndex)) ?? null).toEqual(
        direction === "forward" ? null : [nodeId + 2, nodeId + 1, nodeId],
      );
    }
  }
  expectGraphEdges(osm, expectedEdges, graph);
}

function expectGraphEdges(osm: Osm, expectedEdges: string[], graph = new RoutingGraph(osm)) {
  const actualEdges = [...osm.nodes].flatMap((node) => {
    const nodeIndex = osm.nodes.ids.getIndexFromId(node.id);
    return graph.getEdges(nodeIndex).map((edge) => {
      const targetId = osm.nodes.ids.at(edge.targetNodeIndex);
      const wayId = osm.ways.ids.at(edge.wayIndex);
      return `${wayId}:${node.id}->${targetId}`;
    });
  });
  expect(actualEdges.toSorted()).toEqual(expectedEdges.toSorted());
  expect(graph.edges).toBe(expectedEdges.length);
}

describe("matching and routing way direction", () => {
  it.each(directionCases)(
    "agrees for $name before merge, after merge, and after PBF reload",
    async (scenario) => {
      const base = createWay(
        "base",
        1,
        10,
        scenario.baseValue,
        scenario.roundabout ?? false,
        false,
        0,
      );
      const patch = createWay(
        "patch",
        101,
        20,
        scenario.patchValue,
        scenario.roundabout ?? false,
        scenario.patchReversed ?? false,
        0.000004,
      );
      const baseWay = { nodeId: 1, wayId: 10, direction: scenario.baseDirection };
      const patchWay = { nodeId: 101, wayId: 20, direction: scenario.patchDirection };
      expectDirections(base, [baseWay]);
      expectDirections(patch, [patchWay]);
      const conflation = { propertyKeys: ["name"], attachNetwork: false };
      const candidate = discoverConflationCandidates(base, patch, conflation).candidates.find(
        (row) => row.id === "way:20->10",
      );
      expect(candidate?.propertyTransfer.status).toBe(
        scenario.compatible ? "automatic" : "blocked",
      );
      if (!scenario.compatible) expect(candidate?.reasons).toContain("routing-family-conflict");

      const result = await merge(base, patch, { directMerge: true, conflation }, () => {});
      const reloaded = await fromPbf(await toPbfBuffer(result), { id: "reloaded" });
      for (const osm of [result, reloaded]) {
        expectDirections(osm, [baseWay, patchWay]);
        expect(osm.ways.getById(10)?.tags?.["name"]).toBe(scenario.compatible ? "patch" : "base");
        expect(osm.ways.getById(10)?.refs).toEqual(base.ways.getById(10)?.refs);
        expect(osm.ways.getById(20)?.refs).toEqual(patch.ways.getById(20)?.refs);
      }
    },
  );

  it("blocks oppositely directed closed roundabouts and preserves their directed edges", async () => {
    function roundabout(
      id: string,
      nodeId: number,
      wayId: number,
      reversed: boolean,
      offset: number,
    ) {
      const osm = new Osm({ id });
      const coordinates: [number, number][] = [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
        [0, 0.001],
      ];
      for (const [index, [lon, lat]] of coordinates.entries()) {
        osm.nodes.addNode({ id: nodeId + index, lon, lat: lat + offset });
      }
      osm.nodes.buildIndex();
      const refs = [nodeId, nodeId + 1, nodeId + 2, nodeId + 3, nodeId];
      osm.ways.addWay({
        id: wayId,
        refs: reversed ? refs.toReversed() : refs,
        tags: { highway: "residential", junction: "roundabout", oneway: "yes", name: id },
      });
      osm.buildIndexes();
      osm.buildSpatialIndexes();
      return osm;
    }

    const base = roundabout("base", 1, 10, false, 0);
    const patch = roundabout("patch", 101, 20, true, 0.000004);
    const baseEdges = ["10:1->2", "10:2->3", "10:3->4", "10:4->1"];
    const patchEdges = ["20:101->104", "20:104->103", "20:103->102", "20:102->101"];
    expectGraphEdges(base, baseEdges);
    expectGraphEdges(patch, patchEdges);
    const conflation = { propertyKeys: ["name"], attachNetwork: false };
    const candidate = discoverConflationCandidates(base, patch, conflation).candidates.find(
      (row) => row.id === "way:20->10",
    );
    expect(candidate?.propertyTransfer.status).toBe("blocked");
    expect(candidate?.reasons).toContain("routing-family-conflict");

    const result = await merge(base, patch, { directMerge: true, conflation }, () => {});
    const reloaded = await fromPbf(await toPbfBuffer(result), { id: "reloaded" });
    for (const osm of [result, reloaded]) {
      expectGraphEdges(osm, [...baseEdges, ...patchEdges]);
      expect(osm.ways.getById(10)?.tags?.["name"]).toBe("base");
      expect(osm.ways.getById(20)?.tags?.["name"]).toBe("patch");
      expect(osm.ways.getById(10)?.refs).toEqual([1, 2, 3, 4, 1]);
      expect(osm.ways.getById(20)?.refs).toEqual([101, 104, 103, 102, 101]);
    }
  });
});
