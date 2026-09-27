/**
 * Views of a live merge plan for the worker's paged, serializable API: an overview, filtered
 * feature pages, one feature's evidence, a map layer, and bulk decisions.
 */
import {
  getMergePlanCandidate,
  type MergePlan,
  type OsmConflationCandidate,
  PLAN_OUTCOME_PRIORITY,
  type PlanDecision,
  type PlanFeature,
  type PlanOutcome,
  type PlanProposal,
  type PlanProposalStatus,
} from "@osmix/change";
import type { Osm } from "@osmix/core";
import type { LonLat, OsmTags } from "@osmix/types";

/** Everything about a plan except its features, for headers and summaries. */
export interface MergePlanOverview {
  inputs: MergePlan["inputs"];
  options: MergePlan["options"];
  idRemap: MergePlan["idRemap"];
  summary: MergePlan["summary"];
  diagnostics: MergePlan["diagnostics"];
  matching?: MergePlan["matching"];
  decisions: PlanDecision[];
  staleDecisions: string[];
  featureCount: number;
}

/** Which features a page shows. Every set field must match. */
export interface MergePlanFilter {
  outcome?: PlanOutcome;
  /** Features with at least one proposal of this kind. */
  kind?: PlanProposal["kind"];
  /** Features with at least one proposal with this status. */
  status?: PlanProposalStatus;
  /** Features with at least one proposal with this reason. */
  reason?: string;
}

/** A feature row: the feature, its proposals, and a label from the patch's tags. */
export interface MergePlanFeatureView extends PlanFeature {
  name?: string;
  tags?: OsmTags;
  proposals: PlanProposal[];
}

export interface MergePlanPage {
  features: MergePlanFeatureView[];
  total: number;
  totalPages: number;
}

/** One feature with the evidence behind its matching proposals and the geometry involved. */
export interface MergePlanFeatureDetail extends MergePlanFeatureView {
  candidates: Record<string, OsmConflationCandidate>;
  /** The imported feature's coordinates, as loaded. */
  coordinates: LonLat[];
  /** Coordinates of each base entity a proposal targets, by proposal ID. */
  targets: Record<string, LonLat[]>;
}

export interface MergePlanBulkRequest {
  action: "accept" | "reject" | "clear";
  filter: MergePlanFilter;
}

export interface MergePlanBulkResult {
  overview: MergePlanOverview;
  /** Decisions this request added, replaced, or cleared. */
  changed: number;
  /** Matching proposals left alone because they have alternatives to choose between. */
  skipped: number;
}

/** GeoJSON of the plan's imported features, coloured by outcome on the map. */
export interface MergePlanLayer {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry:
      | { type: "Point"; coordinates: LonLat }
      | { type: "LineString"; coordinates: LonLat[] };
    properties: { featureKey: string; outcome: PlanOutcome };
  }[];
}

const DIRECT_KINDS = new Set<PlanProposal["kind"]>(["add", "same-id-replace"]);

export function planOverview(plan: MergePlan): MergePlanOverview {
  return structuredClone({
    inputs: plan.inputs,
    options: plan.options,
    idRemap: plan.idRemap,
    summary: plan.summary,
    diagnostics: plan.diagnostics,
    ...(plan.matching ? { matching: plan.matching } : {}),
    decisions: [...(plan.options.decisions ?? [])],
    staleDecisions: plan.staleDecisions,
    featureCount: plan.features.length,
  });
}

function proposalsOf(plan: MergePlan, feature: PlanFeature) {
  return feature.proposalIds.map((id) => plan.proposals.get(id)!);
}

function matchesFilter(plan: MergePlan, feature: PlanFeature, filter: MergePlanFilter) {
  if (filter.outcome && feature.outcome !== filter.outcome) return false;
  if (!filter.kind && !filter.status && !filter.reason) return true;
  return proposalsOf(plan, feature).some(
    (proposal) =>
      (!filter.kind || proposal.kind === filter.kind) &&
      (!filter.status || proposal.status === filter.status) &&
      (!filter.reason || proposal.reasons.includes(filter.reason)),
  );
}

/** The feature as loaded, by its original patch ID. */
function patchEntity(patch: Osm, feature: PlanFeature) {
  if (feature.type === "node") return patch.nodes.getById(feature.originalId);
  if (feature.type === "way") return patch.ways.getById(feature.originalId);
  return patch.relations.getById(feature.originalId);
}

function featureView(plan: MergePlan, patch: Osm, feature: PlanFeature): MergePlanFeatureView {
  const tags = patchEntity(patch, feature)?.tags;
  const name = tags?.["name"];
  return structuredClone({
    ...feature,
    ...(tags ? { tags } : {}),
    ...(name != null ? { name: String(name) } : {}),
    proposals: proposalsOf(plan, feature),
  });
}

/** Features that match `filter`: decisions first, then by outcome, then in patch order. */
function filteredFeatures(plan: MergePlan, filter: MergePlanFilter) {
  const rank = (feature: PlanFeature) => PLAN_OUTCOME_PRIORITY.indexOf(feature.outcome);
  return plan.features
    .filter((feature) => matchesFilter(plan, feature, filter))
    .toSorted((a, b) => rank(a) - rank(b));
}

/** `patch` is the patch as loaded; features are found by their original IDs. */
export function planPage(
  plan: MergePlan,
  patch: Osm,
  filter: MergePlanFilter,
  page: number,
  pageSize: number,
): MergePlanPage {
  const features = filteredFeatures(plan, filter);
  return {
    features: features
      .slice(page * pageSize, (page + 1) * pageSize)
      .map((feature) => featureView(plan, patch, feature)),
    total: features.length,
    totalPages: Math.ceil(features.length / pageSize),
  };
}

function coordinates(osm: Osm, type: PlanFeature["type"], id: number): LonLat[] {
  if (type === "node") {
    const node = osm.nodes.getById(id);
    return node ? [[node.lon, node.lat]] : [];
  }
  if (type === "way") {
    const way = osm.ways.getById(id);
    return (way?.refs ?? []).flatMap((ref) => {
      const node = osm.nodes.getById(ref);
      return node ? [[node.lon, node.lat] as LonLat] : [];
    });
  }
  return [];
}

export function planFeatureDetail(
  plan: MergePlan,
  base: Osm,
  patch: Osm,
  featureKey: string,
): MergePlanFeatureDetail {
  const feature = plan.features.find(({ key }) => key === featureKey);
  if (!feature) throw Error(`No feature ${featureKey} in this merge plan`);
  const candidates: Record<string, OsmConflationCandidate> = {};
  const targets: Record<string, LonLat[]> = {};
  for (const proposal of proposalsOf(plan, feature)) {
    const candidate = getMergePlanCandidate(plan, proposal.id);
    if (candidate) candidates[proposal.id] = structuredClone(candidate);
    if ("target" in proposal) {
      targets[proposal.id] = coordinates(base, proposal.target.type, proposal.target.id);
    }
  }
  return {
    ...featureView(plan, patch, feature),
    candidates,
    coordinates: coordinates(patch, feature.type, feature.originalId),
    targets,
  };
}

export function planLayer(plan: MergePlan, patch: Osm): MergePlanLayer {
  const features: MergePlanLayer["features"] = [];
  for (const feature of plan.features) {
    const points = coordinates(patch, feature.type, feature.originalId);
    const properties = { featureKey: feature.key, outcome: feature.outcome };
    if (feature.type === "node" && points[0]) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: points[0] },
        properties,
      });
    } else if (feature.type === "way" && points.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: points },
        properties,
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/**
 * The decisions after a bulk request. Accepting applies only to proposals that need a
 * decision and have no alternatives; rejecting applies to every decidable proposal; clearing
 * removes decisions. Proposals whose kind, status or reason differs from the filter's are
 * left alone.
 */
export function bulkDecisions(plan: MergePlan, request: MergePlanBulkRequest) {
  const decisions = new Map(
    (plan.options.decisions ?? []).map((decision) => [decision.proposalId, decision.action]),
  );
  let changed = 0;
  let skipped = 0;
  const { filter } = request;
  for (const feature of filteredFeatures(plan, filter)) {
    for (const proposal of proposalsOf(plan, feature)) {
      if (DIRECT_KINDS.has(proposal.kind) || proposal.status === "blocked") continue;
      if (filter.kind && proposal.kind !== filter.kind) continue;
      if (filter.status && proposal.status !== filter.status) continue;
      if (filter.reason && !proposal.reasons.includes(filter.reason)) continue;
      if (request.action === "clear") {
        if (decisions.delete(proposal.id)) changed++;
        continue;
      }
      if (request.action === "accept") {
        if (proposal.status !== "review") continue;
        if ("alternatives" in proposal && proposal.alternatives.length > 0) {
          skipped++;
          continue;
        }
      }
      if (decisions.get(proposal.id) === request.action) continue;
      decisions.set(proposal.id, request.action);
      changed++;
    }
  }
  return {
    decisions: [...decisions].map(([proposalId, action]) => ({ proposalId, action })),
    changed,
    skipped,
  };
}
