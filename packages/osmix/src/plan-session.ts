/**
 * Views of a live merge plan for the worker's paged, serializable API: an overview, filtered
 * feature pages, one feature's evidence, and bulk decisions. `plan-tiles.ts` draws the map.
 */
import {
  getMergePlanCandidate,
  type MergePlan,
  type OsmConflationCandidate,
  type OsmConflationOutcomeFeature,
  type OsmConflationOutcomeReport,
  type OsmConflationTagOutcome,
  type OsmConflationUncopiedTagFeature,
  PLAN_OUTCOME_PRIORITY,
  type PlanDecision,
  type PlanFeature,
  type PlanOutcome,
  type PlanProposal,
  type PlanProposalStatus,
} from "@osmix/change";
import type { Osm } from "@osmix/core";
import type { LonLat, OsmTags } from "@osmix/types";

/** A tag's matching outcome, with a count in place of its list of values not copied. */
export type MergePlanTagOutcome = Omit<OsmConflationTagOutcome, "uncopied"> & {
  uncopiedFeatures: number;
};

/**
 * The matching outcome without its per-feature lists, which can hold an entry for every imported
 * feature: read those a page at a time with `getMergeMatchingPage` and
 * `getMergeUncopiedTagPage`.
 */
export type MergePlanMatchingOutcome = Omit<OsmConflationOutcomeReport, "features" | "tags"> & {
  tags: MergePlanTagOutcome[];
  /** Features whose matching removes the imported way. */
  wayRemovalFeatures: number;
};

/** Everything about a plan except its features, for headers and summaries. */
export interface MergePlanOverview {
  inputs: MergePlan["inputs"];
  options: MergePlan["options"];
  idRemap: MergePlan["idRemap"];
  summary: MergePlan["summary"];
  diagnostics: MergePlan["diagnostics"];
  matching?: {
    candidates: NonNullable<MergePlan["matching"]>["candidates"];
    outcome: MergePlanMatchingOutcome;
  };
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
  /**
   * Proposals an accept left alone because they need their own choice: removals, and proposals
   * with alternatives or competitors.
   */
  skipped: number;
}

/** Which matching outcome features a page shows. */
export type MergeMatchingFilter = "unresolved" | "skipped" | "way-removal" | "all";

export interface MergeMatchingPage {
  features: OsmConflationOutcomeFeature[];
  total: number;
  totalPages: number;
}

export interface MergeUncopiedTagPage {
  features: OsmConflationUncopiedTagFeature[];
  total: number;
  totalPages: number;
}

const DIRECT_KINDS = new Set<PlanProposal["kind"]>(["add", "same-id-replace"]);

export function planOverview(plan: MergePlan): MergePlanOverview {
  return structuredClone({
    inputs: plan.inputs,
    options: plan.options,
    idRemap: plan.idRemap,
    summary: plan.summary,
    diagnostics: plan.diagnostics,
    ...(plan.matching
      ? {
          matching: {
            candidates: plan.matching.candidates,
            outcome: matchingOutcome(plan.matching.outcome),
          },
        }
      : {}),
    decisions: [...(plan.options.decisions ?? [])],
    staleDecisions: plan.staleDecisions,
    featureCount: plan.features.length,
  });
}

function matchingOutcome(report: OsmConflationOutcomeReport): MergePlanMatchingOutcome {
  const { features, tags, ...rest } = report;
  return {
    ...rest,
    tags: tags.map(({ uncopied, ...tag }) => ({ ...tag, uncopiedFeatures: uncopied.length })),
    wayRemovalFeatures: features.filter((feature) => feature.wayRemoval).length,
  };
}

function pageOf<T>(items: readonly T[], page: number, pageSize: number) {
  const totalPages = Math.ceil(items.length / pageSize);
  return {
    features: items.slice(page * pageSize, (page + 1) * pageSize),
    total: items.length,
    totalPages,
  };
}

function matchesMatchingFilter(feature: OsmConflationOutcomeFeature, filter: MergeMatchingFilter) {
  switch (filter) {
    case "unresolved":
      return feature.unresolved !== null;
    case "skipped":
      return feature.skipped;
    case "way-removal":
      return feature.wayRemoval !== undefined;
    case "all":
      return true;
  }
}

/** One page of the matching outcome's features that match `filter`, in report order. */
export function matchingPage(
  report: OsmConflationOutcomeReport,
  filter: MergeMatchingFilter,
  page: number,
  pageSize: number,
): MergeMatchingPage {
  const features =
    filter === "all"
      ? report.features
      : report.features.filter((feature) => matchesMatchingFilter(feature, filter));
  return structuredClone(pageOf(features, page, pageSize));
}

/** One page of the imported features whose value for tag `key` was not copied. */
export function uncopiedTagPage(
  report: OsmConflationOutcomeReport,
  key: string,
  page: number,
  pageSize: number,
): MergeUncopiedTagPage {
  const tag = report.tags.find((candidate) => candidate.key === key);
  if (!tag) throw Error(`No tag ${key} in this matching outcome`);
  return structuredClone(pageOf(tag.uncopied, page, pageSize));
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

/**
 * The decisions after a bulk request. Accepting applies only to proposals that need a
 * decision and exclude no others (no alternatives or competitors), never to a removal, which
 * needs its own choice; rejecting applies to every decidable proposal; clearing
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
        // Removal needs its own consent (MP-R1); a proposal that excludes others needs a choice
        // between them (MP-M5).
        if (
          proposal.kind === "remove-way" ||
          ("competitors" in proposal &&
            (proposal.alternatives.length > 0 || proposal.competitors.length > 0))
        ) {
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
