/** Routing families, protected and routing-affecting keys, and node routing signatures. */
import type { OsmTags, OsmWay } from "@osmix/types";

import type { OsmConflationRoutingFamily } from "../types.ts";
import { accessSignature, ROUTING_ACCESS_KEYS } from "./access.ts";
import { isAreaWay } from "./area.ts";
import { routingGradeSignature } from "./grade.ts";

export const PEDESTRIAN_HIGHWAYS = new Set(["corridor", "footway", "path", "pedestrian", "steps"]);

export const BICYCLE_HIGHWAYS = new Set(["cycleway"]);

export const NON_MOTOR_HIGHWAYS = new Set([
  ...PEDESTRIAN_HIGHWAYS,
  ...BICYCLE_HIGHWAYS,
  "bridleway",
]);

export const PROTECTED_KEYS = new Set([
  "area",
  "bridge",
  "covered",
  "layer",
  "level",
  "restriction",
  "tunnel",
  "type",
]);

export const ROUTING_KEYS = new Set([
  ...ROUTING_ACCESS_KEYS,
  "barrier",
  "crossing",
  "highway",
  "junction",
  "kerb",
  "maxspeed",
  "oneway",
]);

export function isProtectedProperty(key: string) {
  return PROTECTED_KEYS.has(key) || key.startsWith("restriction:");
}

export function isRoutingProperty(key: string) {
  return [...ROUTING_KEYS].some(
    (routingKey) => key === routingKey || key.startsWith(`${routingKey}:`),
  );
}

export function nodeRoutingSignature(tags: OsmTags | undefined) {
  return Object.keys(tags ?? {})
    .filter(
      (key) =>
        isRoutingProperty(key) &&
        !ROUTING_ACCESS_KEYS.some(
          (accessKey) => key === accessKey || key.startsWith(`${accessKey}:`),
        ) &&
        key !== "barrier" &&
        !key.startsWith("barrier:"),
    )
    .toSorted()
    .map((key) => `${key}=${String(tags?.[key] ?? "")}`)
    .join("|");
}

export function wayRoutingFamily(way: OsmWay): OsmConflationRoutingFamily {
  const highway = String(way.tags?.["highway"] ?? "");
  if (!highway || isAreaWay(way)) return "non-routable";
  if (
    BICYCLE_HIGHWAYS.has(highway) ||
    (highway === "path" && !["no", "private"].includes(String(way.tags?.["bicycle"] ?? "")))
  ) {
    return "bicycle-shared";
  }
  if (PEDESTRIAN_HIGHWAYS.has(highway)) return "pedestrian";
  // Unknown highway values stay in the motor family. Treating a potentially
  // drivable way as non-routable would make an unsafe attachment look harmless.
  if (!NON_MOTOR_HIGHWAYS.has(highway)) return "motor-road";
  return "non-routable";
}

export function routingFamilies(ways: readonly OsmWay[]) {
  const families = new Set(ways.map(wayRoutingFamily));
  if (families.size > 1) families.delete("non-routable");
  return [...families].toSorted() as OsmConflationRoutingFamily[];
}

export function familyCompatible(a: OsmConflationRoutingFamily, b: OsmConflationRoutingFamily) {
  if (a === b) return true;
  return (
    (a === "pedestrian" && b === "bicycle-shared") || (a === "bicycle-shared" && b === "pedestrian")
  );
}

export function wayGradeAccessCompatible(source: OsmWay, target: OsmWay) {
  return (
    routingGradeSignature(source.tags) === routingGradeSignature(target.tags) &&
    accessSignature(source.tags) === accessSignature(target.tags)
  );
}
