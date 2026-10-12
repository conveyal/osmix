import type { OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { junctionHasIncompatibleGrades } from "../src/integrity.ts";
import { assessJunction } from "../src/rules/node-identity.ts";

/**
 * Two connections to one base node compete only when their points share an imported way
 * (MP-M5); discovery has no grade rivalry. That holds because each connection alone must pass
 * the junction's grade rule with every highway at the node. This search over small junctions
 * checks that no two connections that pass alone fail together, so if the grade or portal
 * rules change and the case becomes possible, it fails here.
 */

const GRADES = {
  surface: {},
  bridge: { bridge: "yes", layer: "1" },
  tunnel: { tunnel: "yes", layer: "-1" },
  level: { level: "1" },
} as const;
type Grade = keyof typeof GRADES;

interface Shape {
  grade: Grade;
  /** The way passes through the node rather than ending there. */
  through: boolean;
  /** A routable highway (`footway`) or one matching cannot join (`bridleway`). */
  routable: boolean;
}

const NODE = 1;
let nextWayId = 100;

function way({ grade, through, routable }: Shape, at = NODE): OsmWay {
  const id = nextWayId++;
  const [before, after] = [id * 10 + 1, id * 10 + 2];
  return {
    id,
    refs: through ? [before, at, after] : [at, before],
    tags: { highway: routable ? "footway" : "bridleway", ...GRADES[grade] },
  };
}

const grades = Object.keys(GRADES) as Grade[];
const shapes = (routable: boolean[]) =>
  grades.flatMap((grade) =>
    [false, true].flatMap((through) => routable.map((r) => ({ grade, through, routable: r }))),
  );
const baseShapes = shapes([true, false]);
const importedShapes = shapes([true]);

/** Every base junction of up to three highways, as shapes. */
function* baseJunctions(): Generator<Shape[]> {
  yield [];
  for (let a = 0; a < baseShapes.length; a++) {
    yield [baseShapes[a]!];
    for (let b = a; b < baseShapes.length; b++) {
      yield [baseShapes[a]!, baseShapes[b]!];
      for (let c = b; c < baseShapes.length; c++) {
        yield [baseShapes[a]!, baseShapes[b]!, baseShapes[c]!];
      }
    }
  }
}

const rewrite = (imported: OsmWay, source: number) => ({
  ...imported,
  refs: imported.refs.map((ref) => (ref === source ? NODE : ref)),
});

/** Pairs of connections that each pass at `base` but whose junction together fails. */
function gradeOnlyRivals(base: OsmWay[]) {
  const joinable = base.filter((way) => way.tags?.["highway"] === "footway");
  const rivals: [Shape, Shape][] = [];
  for (const first of importedShapes) {
    for (const second of importedShapes) {
      const a = way(first, 1001);
      const b = way(second, 1002);
      // As discovery checks one connection: joinable routable ways, every highway's junction.
      const alone = (imported: OsmWay, source: number) =>
        assessJunction(NODE, source, [imported], joinable, { junctionWays: base });
      if (alone(a, 1001).length > 0 || alone(b, 1002).length > 0) continue;
      if (junctionHasIncompatibleGrades(NODE, [...base, rewrite(a, 1001), rewrite(b, 1002)])) {
        rivals.push([first, second]);
      }
    }
  }
  return rivals;
}

describe("connections to one base node", () => {
  it("never compete on grade alone where discovery can connect", () => {
    let junctions = 0;
    for (const shapes of baseJunctions()) {
      const base = shapes.map((shape) => way(shape));
      // Discovery connects only to a node with a routable base way, in a junction that is valid.
      if (!base.some((candidate) => candidate.tags?.["highway"] === "footway")) continue;
      if (junctionHasIncompatibleGrades(NODE, base)) continue;
      junctions++;
      expect(gradeOnlyRivals(base), JSON.stringify(shapes)).toEqual([]);
    }
    expect(junctions).toBeGreaterThan(100);
  });

  it("would find such pairs at a node with no base highways, which discovery never connects to", () => {
    // Without a base way there is nothing to join, so each connection alone passes trivially.
    expect(gradeOnlyRivals([])).toContainEqual([
      { grade: "surface", through: false, routable: true },
      { grade: "bridge", through: true, routable: true },
    ]);
  });
});
