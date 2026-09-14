import type { Osm } from "@osmix/core";

import type {
  OsmConflationCandidate,
  OsmConflationDecision,
  OsmConflationDiscovery,
  OsmConflationEntityType,
  OsmConflationOutcomeFeature,
  OsmConflationOutcomeReport,
  OsmConflationReasonCode,
  OsmConflationResolvedActions,
  OsmConflationRetainedImports,
  OsmConflationTagOutcome,
  OsmConflationUncopiedTagReason,
  OsmConflationUnresolvedKind,
  OsmConflationWayRemovalPreview,
} from "./types.ts";

/** Actual changing writers, rather than assignments that merely repeat an existing value. */
export interface ConflationApplicationTrace {
  tagWriters: Map<string, string>;
  alreadyEqualTagValues: Set<string>;
  wayRemovals?: Map<string, OsmConflationWayRemovalPreview>;
}

export function conflationTagTargetKey(candidate: OsmConflationCandidate, key: string): string {
  return `${candidate.entityType}:${candidate.targetId}:${key}`;
}

export function conflationTagSourceKey(candidate: OsmConflationCandidate, key: string): string {
  return `${candidate.id}:${key}`;
}

function entity(osm: Osm, entityType: OsmConflationEntityType, id: number) {
  return entityType === "node" ? osm.nodes.getById(id) : osm.ways.getById(id);
}

function explicitlySkipped(decision: OsmConflationDecision | undefined): boolean {
  return (
    decision?.action === "reject" ||
    (decision?.action === "accept" &&
      decision.transferProperties === false &&
      decision.attachNetwork === false &&
      decision.removeWay !== true)
  );
}

function actualWayRemoval(
  baseline: Osm,
  result: Osm,
  preview: OsmConflationWayRemovalPreview | undefined,
): OsmConflationWayRemovalPreview | undefined {
  if (!preview || !baseline.ways.ids.has(preview.sourceWayId)) return undefined;
  if (result.ways.ids.has(preview.sourceWayId)) return undefined;
  if (!result.ways.ids.has(preview.retainedWayId)) {
    throw Error(`Removed imported way ${preview.sourceWayId} has no retained counterpart`);
  }
  for (const connection of preview.connections) {
    if (
      connection.targetNodeId === null ||
      connection.retainedWayIds.some(
        (id) => !result.ways.getById(id)?.refs.includes(connection.targetNodeId!),
      )
    ) {
      throw Error(`Removed imported way ${preview.sourceWayId} lost a retained branch connection`);
    }
  }
  return {
    ...structuredClone(preview),
    orphanNodeIds: preview.orphanNodeIds.filter(
      (id) => baseline.nodes.ids.has(id) && !result.nodes.ids.has(id),
    ),
    retainedTaggedNodeIds: preview.retainedTaggedNodeIds.filter((id) => result.nodes.ids.has(id)),
  };
}

function retainedImports(base: Osm, patch: Osm, baseline: Osm, result: Osm) {
  const counts: OsmConflationRetainedImports = {
    originalIds: { nodes: 0, ways: 0, relations: 0 },
    ordinaryAdditions: { nodes: 0, ways: 0, relations: 0 },
  };
  for (const type of ["nodes", "ways", "relations"] as const) {
    for (const source of patch[type]) {
      if (!result[type].ids.has(source.id)) continue;
      counts.originalIds[type]++;
      if (!base[type].ids.has(source.id) && baseline[type].ids.has(source.id))
        counts.ordinaryAdditions[type]++;
    }
  }
  return counts;
}

function unresolvedKind(
  candidates: readonly OsmConflationCandidate[],
  selected: OsmConflationCandidate | undefined,
  failedTags: readonly OsmConflationUncopiedTagReason[],
  networkOutstanding: boolean,
): OsmConflationUnresolvedKind | null {
  if (failedTags.length === 0 && !networkOutstanding) return null;
  const relevant = selected ? [selected] : candidates;
  if (relevant.every((candidate) => candidate.targetId == null)) return "unmatched";
  const propertyBlocked =
    failedTags.length > 0 &&
    relevant.every((candidate) => candidate.propertyTransfer.status === "blocked");
  const networkBlocked =
    networkOutstanding &&
    relevant.every((candidate) => candidate.networkAttachment?.status === "blocked");
  if (
    propertyBlocked ||
    networkBlocked ||
    failedTags.some((reason) => ["blocked", "protected-tag", "superseded"].includes(reason))
  )
    return "blocked";
  if (
    !selected &&
    candidates.some((candidate) =>
      candidate.reasons.some((reason) => reason === "multiple-targets" || reason === "many-to-one"),
    )
  )
    return "ambiguous";
  return "review";
}

/** Build a detached report only after successful application and integrity validation. */
export function createConflationOutcomeReport(
  base: Osm,
  patch: Osm,
  ordinaryBaseline: Osm,
  result: Osm,
  discovery: OsmConflationDiscovery,
  decisions: readonly OsmConflationDecision[],
  trace: ConflationApplicationTrace,
  resolveActions: (
    candidate: OsmConflationCandidate,
    decision?: OsmConflationDecision,
  ) => OsmConflationResolvedActions,
): OsmConflationOutcomeReport {
  const decisionsById = new Map(decisions.map((decision) => [decision.candidateId, decision]));
  const groups = new Map<string, OsmConflationCandidate[]>();
  for (const candidate of discovery.candidates) {
    const key = `${candidate.entityType}:${candidate.sourceId}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  // Unmatched candidates have no attachment evidence. Inspect actual ordinary
  // imports too, so an unattached endpoint is still reported as unresolved.
  const sourceWays = new Map<number, number[]>();
  if (discovery.options.attachNetwork) {
    for (const importedWay of patch.ways) {
      if (base.ways.ids.has(importedWay.id)) continue;
      const way = ordinaryBaseline.ways.getById(importedWay.id);
      if (!way) continue;
      for (const sourceId of new Set(way.refs)) {
        if (!groups.has(`node:${sourceId}`)) continue;
        const wayIds = sourceWays.get(sourceId) ?? [];
        wayIds.push(way.id);
        sourceWays.set(sourceId, wayIds);
      }
    }
  }
  const tags: OsmConflationTagOutcome[] = discovery.options.propertyKeys.map((key) => ({
    key,
    presentFeatures: 0,
    copiedFeatures: 0,
    alreadyEqualFeatures: 0,
    satisfiedByOtherCopyFeatures: 0,
    uncopied: [],
  }));
  const features: OsmConflationOutcomeFeature[] = [];
  for (const candidates of groups.values()) {
    const first = candidates[0]!;
    const { entityType, sourceId } = first;
    const source = entity(patch, entityType, sourceId)!;
    const active = candidates.find((candidate) => {
      const actions = resolveActions(candidate, decisionsById.get(candidate.id));
      return actions.transferProperties || actions.attachNetwork || actions.removeWay === true;
    });
    const explicit = candidates.filter((candidate) => {
      const decision = decisionsById.get(candidate.id);
      return decision?.action === "accept" && !explicitlySkipped(decision);
    });
    const selected = active ?? (explicit.length === 1 ? explicit[0] : undefined);
    // A unique unselected target still permits distinguishing a value that was
    // already present from a blocked or unreviewed copy. Alternatives do not.
    const targetCandidate = selected ?? (candidates.length === 1 ? first : undefined);
    const decision = targetCandidate ? decisionsById.get(targetCandidate.id) : undefined;
    const actions = targetCandidate ? resolveActions(targetCandidate, decision) : undefined;
    const skipped = candidates.every((candidate) =>
      explicitlySkipped(decisionsById.get(candidate.id)),
    );
    const targetId = targetCandidate?.targetId ?? null;
    const before = targetId == null ? undefined : entity(ordinaryBaseline, entityType, targetId);
    const after = targetId == null ? undefined : entity(result, entityType, targetId);
    const copiedKeys: string[] = [];
    const failedTags: OsmConflationUncopiedTagReason[] = [];
    const reasons = new Set<OsmConflationReasonCode>(
      (targetCandidate ? [targetCandidate] : candidates).flatMap((candidate) => candidate.reasons),
    );
    for (const tag of tags) {
      const sourceValue = source.tags?.[tag.key];
      if (sourceValue == null) continue;
      tag.presentFeatures++;
      // With no selected target, equality is still certain when every possible
      // target already contained and still retains the imported value.
      if (
        !targetCandidate &&
        candidates.every(
          (candidate) =>
            candidate.targetId != null &&
            entity(ordinaryBaseline, entityType, candidate.targetId)?.tags?.[tag.key] ===
              sourceValue &&
            entity(result, entityType, candidate.targetId)?.tags?.[tag.key] === sourceValue,
        )
      ) {
        tag.alreadyEqualFeatures++;
        continue;
      }
      const finalValue = after?.tags?.[tag.key];
      const beforeValue = before?.tags?.[tag.key];
      const writer = targetCandidate
        ? trace.tagWriters.get(conflationTagTargetKey(targetCandidate, tag.key))
        : undefined;
      if (
        targetCandidate &&
        writer === targetCandidate.id &&
        finalValue === sourceValue &&
        beforeValue !== finalValue
      ) {
        tag.copiedFeatures++;
        copiedKeys.push(tag.key);
        continue;
      }
      if (
        finalValue === sourceValue &&
        (beforeValue === sourceValue ||
          (targetCandidate &&
            trace.alreadyEqualTagValues.has(conflationTagSourceKey(targetCandidate, tag.key))))
      ) {
        tag.alreadyEqualFeatures++;
        continue;
      }
      // Attribution belongs to one surviving writer. Another source whose
      // desired value is present needs no further copy, even if its own write
      // was overwritten and then restored by that final writer.
      if (
        targetCandidate &&
        writer != null &&
        writer !== targetCandidate.id &&
        finalValue === sourceValue
      ) {
        tag.satisfiedByOtherCopyFeatures++;
        continue;
      }
      const diff = targetCandidate?.evidence.tagDiff.find((diff) => diff.key === tag.key);
      let reason: OsmConflationUncopiedTagReason;
      if (skipped || explicitlySkipped(decision) || decision?.transferProperties === false)
        reason = "not-selected";
      else if (targetId == null) reason = "no-accepted-target";
      else if (diff?.protected) reason = "protected-tag";
      else if (targetCandidate?.propertyTransfer.status === "blocked") reason = "blocked";
      else if (actions?.transferProperties) reason = "superseded";
      else reason = "no-accepted-target";
      const tagReasons = targetCandidate
        ? targetCandidate.propertyTransfer.reasons
        : candidates.flatMap((candidate) => candidate.propertyTransfer.reasons);
      tag.uncopied.push({ entityType, sourceId, reason, reasons: [...new Set(tagReasons)] });
      if (reason !== "not-selected") failedTags.push(reason);
    }
    const connectedWayIds: number[] = [];
    let networkOutstanding = false;
    if (
      entityType === "node" &&
      discovery.options.attachNetwork &&
      !skipped &&
      !explicitlySkipped(decision) &&
      decision?.attachNetwork !== false
    ) {
      for (const wayId of sourceWays.get(sourceId) ?? []) {
        const beforeWay = ordinaryBaseline.ways.getById(wayId);
        const afterWay = result.ways.getById(wayId);
        if (!beforeWay || !afterWay) continue;
        if (
          actions?.attachNetwork &&
          beforeWay.refs.some((ref, index) => ref === sourceId && afterWay.refs[index] === targetId)
        )
          connectedWayIds.push(wayId);
        if (afterWay.refs.includes(sourceId)) networkOutstanding = true;
      }
    }
    const unresolved = skipped
      ? null
      : unresolvedKind(candidates, selected, failedTags, networkOutstanding);
    const retained = entity(result, entityType, sourceId) != null;
    const wayRemoval = actualWayRemoval(
      ordinaryBaseline,
      result,
      targetCandidate ? trace.wayRemovals?.get(targetCandidate.id) : undefined,
    );
    features.push({
      entityType,
      sourceId,
      candidateIds: candidates.map((candidate) => candidate.id),
      targetId,
      copiedKeys,
      connectedWayIds,
      unresolved,
      skipped,
      retained,
      ordinaryAddition:
        retained &&
        entity(base, entityType, sourceId) == null &&
        entity(ordinaryBaseline, entityType, sourceId) != null,
      reasons: [...reasons],
      ...(wayRemoval ? { wayRemoval } : {}),
    });
  }
  const applied = (feature: OsmConflationOutcomeFeature) =>
    feature.copiedKeys.length > 0 ||
    feature.connectedWayIds.length > 0 ||
    feature.wayRemoval != null;
  const removals = features.flatMap((feature) => (feature.wayRemoval ? [feature.wayRemoval] : []));
  return {
    summary: {
      features: features.length,
      appliedFeatures: features.filter(applied).length,
      tagCopyActions: features.filter((feature) => feature.copiedKeys.length > 0).length,
      copiedTagValues: features.reduce((count, feature) => count + feature.copiedKeys.length, 0),
      networkAttachmentActions: features.filter((feature) => feature.connectedWayIds.length > 0)
        .length,
      unresolvedFeatures: features.filter((feature) => feature.unresolved != null).length,
      ambiguousFeatures: features.filter((feature) => feature.unresolved === "ambiguous").length,
      blockedFeatures: features.filter((feature) => feature.unresolved === "blocked").length,
      unmatchedFeatures: features.filter((feature) => feature.unresolved === "unmatched").length,
      reviewFeatures: features.filter((feature) => feature.unresolved === "review").length,
      skippedFeatures: features.filter((feature) => feature.skipped).length,
      unchangedFeatures: features.filter(
        (feature) => !applied(feature) && !feature.unresolved && !feature.skipped,
      ).length,
      ...(removals.length > 0
        ? {
            wayRemovalActions: removals.length,
            removedOrphanNodes: new Set(removals.flatMap((removal) => removal.orphanNodeIds)).size,
          }
        : {}),
    },
    features,
    tags,
    stage: "matching-before-intersections",
    retainedImports: retainedImports(base, patch, ordinaryBaseline, result),
  };
}
