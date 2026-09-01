import { Details, DetailsContent, DetailsSummary } from "./details";
import { MergeGuideDiagram, type MergeGuideDiagramId } from "./merge-guide-diagram";
import { SectionTitle } from "./section";

export const MERGE_STEP_GUIDE_IDS = [
  "select",
  "run-all",
  "inspect-base",
  "inspect-patch",
  "direct",
  "review-base-diagnostic",
  "review-patch-diagnostic",
  "review-direct",
  "review-cumulative-exact",
  "review-cumulative-without-exact",
  "review-intersections",
  "match-imported",
  "reconcile",
  "intersections",
  "final",
] as const;

export type MergeStepGuideId = (typeof MERGE_STEP_GUIDE_IDS)[number];

export interface MergeStepGuideDefinition {
  /** The short explanation that remains visible while the detailed disclosure is closed. */
  summary: string;
  /** Datasets, configuration, or generated changes inspected by this stage. */
  inputs: readonly string[];
  /** Mutations this stage may make now or after its changeset is accepted. */
  mutations: readonly string[];
  /** Safety guarantees and data that this stage must preserve. */
  invariants: readonly string[];
  /** The artifact or workflow state produced by the stage. */
  output: string;
  /** A material caveat that should be visible within the detailed explanation. */
  warning?: string;
  /** A diagram used only when it materially clarifies the transformation. */
  diagram?: MergeGuideDiagramId;
}

export const MERGE_STEP_GUIDES = {
  select: {
    summary:
      "Choose the authoritative base dataset and the imported patch, then choose a reviewed or automatic workflow.",
    inputs: [
      "Base OSM: the existing dataset whose IDs and topology are authoritative except where a same-ID patch entity supplies an update.",
      "Patch OSM: imported additions and updates that will be merged into the base.",
      "Optional imported-data matching settings, including selected tag keys and search radius.",
    ],
    mutations: [
      "No OSM entities change here. The browser loads and indexes copies of both PBF files in memory.",
    ],
    invariants: [
      "The source files on disk are never overwritten.",
      "Selecting the automatic workflow does not enable fuzzy matching unless it was explicitly configured.",
    ],
    output:
      "Two indexed inputs and a workflow choice that determine which review checkpoints are shown.",
    diagram: "pipeline",
  },
  "run-all": {
    summary:
      "Run direct merge, exact reconciliation, optional automatic imported-data matches, and intersection creation without review checkpoints.",
    inputs: [
      "The untouched base and patch loaded during input selection.",
      "Imported-data settings only when fuzzy matching was explicitly enabled.",
    ],
    mutations: [
      "The verified cumulative changeset is applied to the in-memory base, followed by a separate intersection changeset.",
      "Diagnostic scans and intermediate review screens are skipped.",
    ],
    invariants: [
      "Only high-confidence automatic fuzzy matches apply without review; unresolved candidates are not silently accepted.",
      "The uploaded source files remain unchanged even after the in-memory base is replaced.",
    ],
    output: "A merged in-memory dataset ready for final inspection and PBF download.",
    warning:
      "Cancellation is best-effort. Osmix checks for it between supported stages, but a long worker operation may finish before the request is observed. Reload the untouched source inputs to undo a completed in-memory mutation.",
    diagram: "pipeline",
  },
  "inspect-base": {
    summary:
      "Scan the base for exact serialized-coordinate and ordered-reference duplicate candidates without changing the base.",
    inputs: [
      "Only the authoritative base OSM and its spatial indexes.",
      "Nodes at the same seven-decimal OSM coordinate and ways with identical ordered references and compatible routing semantics.",
    ],
    mutations: ["None. The scan creates a diagnostic changeset for display but never applies it."],
    invariants: [
      "Nearby but non-identical entities are not reported as exact duplicates.",
      "Base coordinates, references, tags, and relation members remain unchanged.",
    ],
    output: "A review-only list of possible exact duplicates inside the base dataset.",
  },
  "inspect-patch": {
    summary:
      "Scan the patch for exact serialized-coordinate and ordered-reference duplicate candidates without normalizing the imported data.",
    inputs: [
      "Only the imported patch OSM and its spatial indexes.",
      "Nodes at the same seven-decimal OSM coordinate and ways with identical ordered references and compatible routing semantics.",
    ],
    mutations: ["None. The scan creates a diagnostic changeset for display but never applies it."],
    invariants: [
      "The patch is passed untouched to later cross-dataset merge stages.",
      "Nearby but non-identical entities belong in the separate, opt-in imported-data matching workflow.",
    ],
    output: "A review-only list of possible exact duplicates inside the patch dataset.",
  },
  direct: {
    summary:
      "Preview patch additions and same-ID updates while retaining entities that exist only in the base.",
    inputs: ["The original base and patch entities, compared by OSM entity type and ID."],
    mutations: [
      "Patch-only entities are proposed as additions.",
      "A patch entity with the same type and ID as a base entity is proposed as an authoritative update.",
      "This screen only generates a preview; it does not apply those proposals.",
    ],
    invariants: [
      "Base-only entities remain in the result.",
      "No proximity matching, topology attachment, or intersection creation occurs during direct merge.",
      "Both uploaded inputs remain unchanged.",
    ],
    output: "A direct-merge changeset that can be inspected before later cumulative generation.",
    diagram: "direct-merge",
  },
  "review-base-diagnostic": {
    summary:
      "Inspect possible duplicates found inside the base; continuing discards this diagnostic changeset.",
    inputs: ["The base-only scan results from the preceding diagnostic stage."],
    mutations: ["None. Downloading or browsing the diagnostic records does not apply them."],
    invariants: [
      "No base entity coordinates, references, tags, or relation members are changed.",
      "A displayed candidate is evidence for human review, not an automatic merge instruction.",
    ],
    output: "A reviewed diagnostic record; the workflow continues with the unchanged base.",
  },
  "review-patch-diagnostic": {
    summary:
      "Inspect possible duplicates found inside the patch; continuing keeps every patch entity unchanged.",
    inputs: ["The patch-only scan results from the preceding diagnostic stage."],
    mutations: ["None. Downloading or browsing the diagnostic records does not apply them."],
    invariants: [
      "The imported patch remains unchanged for direct merge and cross-dataset reconciliation.",
      "A displayed candidate is evidence for human review, not an automatic merge instruction.",
    ],
    output: "A reviewed diagnostic record; the workflow continues with the unchanged patch.",
  },
  "review-direct": {
    summary:
      "Inspect the direct additions and same-ID updates before the verified merge is regenerated from untouched inputs.",
    inputs: ["The direct-merge preview generated from the original base and patch."],
    mutations: [
      "Approving this checkpoint does not apply the preview. It advances to later matching and reconciliation stages.",
    ],
    invariants: [
      "The original base and patch remain available so cumulative changes can be regenerated deterministically.",
      "No proximity or exact cross-ID match has been included in this preview.",
    ],
    output: "Approval to continue; no OSM data changes at this checkpoint.",
    diagram: "direct-merge",
  },
  "review-cumulative-exact": {
    summary:
      "Inspect the cumulative direct, exact-reconciliation, and accepted imported-data changes before applying them atomically.",
    inputs: [
      "A changeset regenerated from the untouched base and patch.",
      "Enabled exact reconciliation and any saved imported-data match decisions.",
    ],
    mutations: [
      "Applying replaces the in-memory base with the validated cumulative result.",
      "Patch additions, same-ID updates, reconciled references, and explicitly accepted fuzzy actions are applied together.",
    ],
    invariants: [
      "Pre-existing base coordinates, ordered way references, and ordered relation members remain protected from fuzzy conflation.",
      "The integrity validator rejects dangling references, degenerate routable ways, invalid restrictions, and incompatible grade connections.",
      "The source PBF files remain unchanged.",
    ],
    output:
      "A verified in-memory base containing the accepted merge, ready for intersection creation.",
    warning:
      "Applying this changeset is the first irreversible in-memory workflow boundary. Return to the original inputs to undo it.",
    diagram: "exact-reconciliation",
  },
  "review-cumulative-without-exact": {
    summary:
      "Inspect the cumulative direct merge and accepted imported-data changes before applying them atomically.",
    inputs: [
      "A changeset regenerated from the untouched base and patch with cross-ID reconciliation disabled.",
      "Any saved imported-data match decisions.",
    ],
    mutations: [
      "Applying replaces the in-memory base with the validated cumulative result.",
      "Patch additions, same-ID updates, and explicitly accepted fuzzy actions are applied together.",
    ],
    invariants: [
      "Coordinate-equal entities with different IDs remain separate unless an explicit imported-data decision matches them.",
      "The integrity validator rejects dangling references, degenerate routable ways, invalid restrictions, and incompatible grade connections.",
      "The source PBF files remain unchanged.",
    ],
    output:
      "A verified in-memory base containing the accepted merge, ready for intersection creation.",
    warning:
      "Applying this changeset is the first irreversible in-memory workflow boundary. Return to the original inputs to undo it.",
    diagram: "direct-merge",
  },
  "review-intersections": {
    summary:
      "Inspect proposed shared nodes and way-reference edits before completing the merged dataset.",
    inputs: [
      "An intersection-only changeset generated after the cumulative merge was applied and indexed.",
    ],
    mutations: [
      "Applying can reuse a compatible node, replace another nearby endpoint reference, merge non-conflicting node tags, rewrite an affected via-node restriction, and add crossing=yes.",
      "When reuse would collapse a way, applying instead creates one exact node and inserts it into both ways in geometric order.",
    ],
    invariants: [
      "Grade-separated or tag-incompatible crossings remain disconnected.",
      "Node reuse cannot collapse a way; Osmix creates a dedicated exact crossing node when reuse would make topology invalid.",
      "Restriction and reference integrity must remain valid.",
    ],
    output: "The final in-memory merged dataset, or an unchanged dataset when there are no edits.",
    diagram: "intersections",
  },
  "match-imported": {
    summary:
      "Review safe nearby matches for selected property transfer, imported-network attachment, or both.",
    inputs: [
      "The untouched patch compared only against the immutable original base.",
      "Explicit tag keys, network-attachment choice, and candidate search radius.",
      "Geometry, routing family, bearings, access, grade context, and relation participation used as evidence.",
    ],
    mutations: [
      "Discovery and decisions do not mutate OSM data.",
      "Property transfer can overwrite only selected base tag values; an absent patch value never deletes a base value.",
      "Network attachment can later rewrite only patch-created way references to a preserved base node.",
      "An equivalent one-to-one patch way can be suppressed after transfer; only newly imported tagless nodes left unreferenced by every way and relation are cleaned up.",
    ],
    invariants: [
      "Fuzzy matching preserves original base IDs, coordinates, ordered way references, and relation membership; ordinary same-ID patch updates remain authoritative in the direct-merge baseline.",
      "Protected structural tags cannot transfer fuzzily, and routing-affecting properties require review.",
      "Ambiguous, many-to-one, grade-conflicting, restricted, or structurally invalid candidates are not accepted automatically.",
    ],
    output:
      "Saved automatic, accepted, rejected, review, blocked, and unmatched candidate decisions for cumulative generation.",
    warning:
      "Rejecting a proposed match rejects only conflation. It does not delete the imported entity, which still proceeds through ordinary direct merge when otherwise unmatched.",
    diagram: "fuzzy-conflation",
  },
  reconcile: {
    summary:
      "Regenerate the merge and represent exact, uniquely compatible patch entities with preserved base entities.",
    inputs: [
      "The untouched base and patch, plus any reviewed imported-data decisions.",
      "Exact coordinates or ordered geometry together with routing, access, grade, and relation context.",
    ],
    mutations: [
      "The generated changeset can rewrite patch references to the surviving base entity.",
      "Equivalent patch ways can be suppressed while the base way ID is preserved.",
      "Base nodes receive missing non-conflicting patch tags; base ways receive missing non-conflicting descriptive patch tags.",
      "No generated changes are applied until the following review screen.",
    ],
    invariants: [
      "Candidates must have a unique compatible base target; ambiguous matches remain separate.",
      "Reconciliation never scans base-to-base or patch-to-patch and never follows transitive replacement chains.",
      "Conflicting routing-critical tags, restrictions, or grade context prevent unsafe reconciliation.",
    ],
    output:
      "A cumulative changeset with direct merge, optional accepted fuzzy actions, and optional exact reconciliation.",
    diagram: "exact-reconciliation",
  },
  intersections: {
    summary:
      "Find compatible same-grade highway crossings and propose shared nodes that connect their way geometry.",
    inputs: [
      "The indexed cumulative merge result and patch ways that may cross existing ways.",
      "Precise segment geometry plus highway, layer, level, bridge, tunnel, and covered context.",
    ],
    mutations: [
      "The generated changeset can reuse a compatible nearby node, replace the other nearby endpoint reference, merge non-conflicting node tags, rewrite affected via-node restrictions, and add crossing=yes.",
      "Without safe reuse, it creates one exact crossing node and inserts it into both ways in geometric order.",
      "No intersection edits are applied until the following review screen.",
    ],
    invariants: [
      "Grade-separated and incompatible crossings remain disconnected.",
      "A nearby endpoint is reused only when the replacement cannot collapse or otherwise degenerate a way.",
      "Multiple intersections on one segment are inserted in traversal order.",
    ],
    output: "An intersection-only changeset for final review and application.",
    diagram: "intersections",
  },
  final: {
    summary:
      "Inspect the in-memory merged result and download a new PBF when its topology and entities look correct.",
    inputs: [
      "The applied cumulative merge and, unless skipped, the applied intersection changeset.",
      "Optional routing diagnostics retained from imported-network attachment.",
    ],
    mutations: [
      "Map inspection and entity selection are read-only.",
      "Downloading serializes the in-memory result as a new OSM PBF file.",
      "Saving stores the indexed Osmix dataset in browser storage for later reuse; it does not create a PBF file.",
    ],
    invariants: [
      "The original base and patch files on disk remain untouched.",
      "The merged dataset stays in browser memory until downloaded or saved to browser storage.",
    ],
    output:
      "A downloaded merged OSM PBF, a reusable indexed browser copy, or both, depending on the selected actions.",
  },
} as const satisfies Record<MergeStepGuideId, MergeStepGuideDefinition>;

function GuideList({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc pl-4">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function GuideHeading({ children }: { children: string }) {
  return (
    <div role="heading" aria-level={3}>
      <SectionTitle>{children}</SectionTitle>
    </div>
  );
}

export function MergeStepGuide({
  defaultOpen = false,
  guideId,
}: {
  defaultOpen?: boolean;
  guideId: MergeStepGuideId;
}) {
  const guide = MERGE_STEP_GUIDES[guideId];

  return (
    <div
      className="flex w-full flex-col gap-2 font-normal normal-case tracking-normal"
      data-guide-id={guideId}
      data-slot="merge-step-guide"
    >
      <p className="px-2 pt-2 text-muted-foreground" data-slot="merge-step-guide-summary">
        {guide.summary}
      </p>
      <Details className="border-b" defaultOpen={defaultOpen}>
        <DetailsSummary>How this step works</DetailsSummary>
        <DetailsContent>
          <div className="flex flex-col gap-2 bg-muted/50 p-2" data-slot="merge-step-guide-details">
            {"diagram" in guide ? (
              <div className="mx-auto w-full max-w-64 overflow-hidden border bg-card p-2">
                <MergeGuideDiagram diagram={guide.diagram} />
              </div>
            ) : null}

            <div className="flex flex-col gap-1">
              <GuideHeading>Inputs</GuideHeading>
              <GuideList items={guide.inputs} />
            </div>

            <div className="flex flex-col gap-1">
              <GuideHeading>What can change</GuideHeading>
              <GuideList items={guide.mutations} />
            </div>

            <div className="flex flex-col gap-1">
              <GuideHeading>Safety guarantees</GuideHeading>
              <GuideList items={guide.invariants} />
            </div>

            <div className="flex flex-col gap-1">
              <GuideHeading>Output</GuideHeading>
              <p>{guide.output}</p>
            </div>

            {"warning" in guide ? (
              <div className="border border-warning/40 bg-warning/10 p-2" role="note">
                <GuideHeading>Caution</GuideHeading>
                <p>{guide.warning}</p>
              </div>
            ) : null}
          </div>
        </DetailsContent>
      </Details>
    </div>
  );
}
