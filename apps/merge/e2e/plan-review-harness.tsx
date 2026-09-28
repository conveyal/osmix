/**
 * Production Merge components on small fixtures, for browser checks that need no PBF parsing
 * or map: input-card containment, the matching settings, the plan review against a real
 * in-page worker, and match evidence.
 */
import { Button, Card, TaskLockProvider } from "@osmix/ui";
import { createStore, Provider } from "jotai";
import {
  type MergePlanBulkRequest,
  type MergePlanFeatureDetail,
  type MergePlanFilter,
  type MergePlanOverview,
  type MergePlanPage,
  type OsmConflationCandidate,
  Osm,
  OsmixWorker,
  type PatchIdMode,
  type PlanDecision,
} from "osmix";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import "../src/main.css";
import { CandidateEvidence } from "../src/components/conflation-candidate-evidence";
import { ConflationConfig } from "../src/components/conflation-config";
import { OsmInputCardHeader } from "../src/components/osm-input-card-header";
import { PatchIdNotice } from "../src/components/patch-id-notice";
import { PlanInputs } from "../src/components/plan-inputs";
import { PLAN_PAGE_SIZE, PlanReview } from "../src/components/plan-review";
import { PlanSummary } from "../src/components/plan-summary";
import { withDecision } from "../src/lib/merge-plan-workflow";
import { createWayRemovalInputs } from "../tests/fixtures/way-removal";
import { createHarnessStore } from "./harness-store";

class HarnessWorker extends OsmixWorker {
  add(osm: Osm) {
    this.set(osm.id, osm);
  }
}

/** Positive patch IDs that name base entities, plus a new feature. */
function patchIdInputs() {
  const base = new Osm({ id: "ids-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { amenity: "bench" } });
  base.nodes.addNode({ id: 2, lon: 0.01, lat: 0.01, tags: { amenity: "toilets" } });
  const patch = new Osm({ id: "ids-patch" });
  patch.nodes.addNode({ id: 1, lon: 0.005, lat: 0.005, tags: { amenity: "bench", seats: "4" } });
  patch.nodes.addNode({ id: 2, lon: 0.02, lat: 0.02, tags: { amenity: "drinking_water" } });
  patch.nodes.addNode({ id: -1, lon: 0.03, lat: 0.03, tags: { amenity: "waste_basket" } });
  for (const osm of [base, patch]) {
    osm.buildIndexes();
    osm.buildSpatialIndexes();
  }
  return { base, patch };
}

type FixtureName = "removal" | "patch-ids";

interface Session {
  fixture: FixtureName;
  worker: HarnessWorker;
  baseId: string;
  patchId: string;
  mode: PatchIdMode;
  overview: MergePlanOverview;
  filter: MergePlanFilter;
  page: MergePlanPage;
  pageIndex: number;
  detail: MergePlanFeatureDetail | null;
  calls: string[];
}

function startSession(fixture: FixtureName, mode: PatchIdMode = "osm"): Session {
  const { base, patch } =
    fixture === "removal" ? createWayRemovalInputs({ branch: true }) : patchIdInputs();
  const worker = new HarnessWorker();
  worker.add(base);
  worker.add(patch);
  const overview = worker.planMerge(base.id, patch.id, {
    patchIds: mode,
    createIntersections: false,
    ...(fixture === "removal"
      ? {
          matching: {
            propertyKeys: ["name"],
            attachNetwork: true,
            allowWayRemoval: true,
            maxDistanceMeters: 1,
            automatic: "none" as const,
          },
        }
      : {}),
  });
  return {
    fixture,
    worker,
    baseId: base.id,
    patchId: patch.id,
    mode,
    overview,
    filter: {},
    page: worker.getMergePlanPage(base.id, 0, PLAN_PAGE_SIZE),
    pageIndex: 0,
    detail: null,
    calls: [],
  };
}

const store = createHarnessStore(() => startSession("removal"));

/** Refresh everything a decision can change, keeping the page and the open feature. */
function refresh(session: Session, overview: MergePlanOverview) {
  session.overview = overview;
  session.page = session.worker.getMergePlanPage(session.baseId, session.pageIndex, PLAN_PAGE_SIZE);
  if (session.detail) {
    session.detail = session.worker.getMergePlanFeature(session.baseId, session.detail.key);
  }
}

const handlers = {
  decide: (
    proposalId: string,
    action: PlanDecision["action"] | null,
    excludes: readonly string[],
  ) =>
    store.mutate((session) => {
      session.calls.push(`decide:${proposalId}:${action ?? "clear"}`);
      const decisions = withDecision(session.overview.decisions, proposalId, action, excludes);
      refresh(session, session.worker.setMergePlanDecisions(session.baseId, decisions));
    }),
  bulk: (request: MergePlanBulkRequest) =>
    store.mutate((session) => {
      session.calls.push(`bulk:${request.action}`);
      refresh(session, session.worker.applyMergePlanBulk(session.baseId, request).overview);
    }),
  filter: (filter: MergePlanFilter) =>
    store.mutate((session) => {
      session.worker.setMergePlanFilter(session.baseId, filter);
      session.filter = filter;
      session.pageIndex = 0;
      refresh(session, session.overview);
    }),
  page: (pageIndex: number) =>
    store.mutate((session) => {
      session.pageIndex = pageIndex;
      refresh(session, session.overview);
    }),
  select: (featureKey: string) =>
    store.mutate((session) => {
      session.detail = session.worker.getMergePlanFeature(session.baseId, featureKey);
    }),
  patchIds: (mode: PatchIdMode) => store.replace(startSession(store.current.fixture, mode)),
};

const candidate = (distanceMeters: number, targetId: number | null): OsmConflationCandidate => ({
  id: `node:101->${targetId ?? "none"}`,
  entityType: "node",
  sourceId: 101,
  targetId,
  status: targetId == null ? "unmatched" : "review",
  reasons: [],
  propertyTransfer: { status: targetId == null ? "unmatched" : "review", reasons: [] },
  networkAttachment: null,
  evidence: {
    distanceMeters,
    sourceRoutingFamilies: ["pedestrian"],
    targetRoutingFamilies: targetId == null ? [] : ["pedestrian"],
    tagDiff: [],
  },
});

const EVIDENCE = [
  { label: "Finite distance", candidate: candidate(0.452, 1) },
  { label: "Unavailable distance", candidate: candidate(Number.NaN, 1) },
  { label: "No eligible target", candidate: candidate(Number.POSITIVE_INFINITY, null) },
];

const settingsStore = createStore();

function Harness() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const session = snapshot.session;
  return (
    <TaskLockProvider locked={false}>
      <main className="flex w-full max-w-[512px] flex-col gap-4 p-2" data-testid="harness-sidebar">
        <section data-testid="input-card-harness" className="flex flex-col gap-2">
          <Card>
            <OsmInputCardHeader
              fileName="an-extremely-long-base-osm-filename-that-must-not-push-actions-outside-the-card.pbf"
              kind="base"
              loaded
              onClear={async () => {}}
              onDownload={async () => {}}
              title="Base OSM — authoritative existing dataset"
            />
          </Card>
        </section>
        <Provider store={settingsStore}>
          <section data-testid="settings-harness" className="flex flex-col gap-2">
            <ConflationConfig />
            <PlanInputs disabled={false} onApplyAutomatically={() => {}} onReviewPlan={() => {}} />
          </section>
        </Provider>
        <section data-testid="plan-review-harness" className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => store.replace(startSession("removal"))}
            >
              Load removal fixture
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => store.replace(startSession("patch-ids"))}
            >
              Load patch ID fixture
            </Button>
          </div>
          <PatchIdNotice
            mode={session.mode}
            replacesBase={session.overview.summary.replacesBase}
            onChange={handlers.patchIds}
          />
          <PlanSummary overview={session.overview} />
          <PlanReview
            detail={session.detail}
            filter={session.filter}
            page={session.page}
            pageIndex={session.pageIndex}
            onBulk={handlers.bulk}
            onDecide={handlers.decide}
            onFilterChange={handlers.filter}
            onPageChange={handlers.page}
            onSelect={handlers.select}
          />
        </section>
        <section data-testid="evidence-harness" className="flex flex-col gap-2">
          {EVIDENCE.map(({ label, candidate: evidence }) => (
            <section key={label} aria-label={label}>
              <CandidateEvidence candidate={evidence} />
            </section>
          ))}
        </section>
      </main>
    </TaskLockProvider>
  );
}

declare global {
  interface Window {
    planReviewHarness: {
      readState: () => {
        decisions: PlanDecision[];
        calls: string[];
        features: Record<string, string>;
      };
    };
  }
}

window.planReviewHarness = {
  readState: () => ({
    decisions: store.current.overview.decisions,
    calls: [...store.current.calls],
    features: Object.fromEntries(
      store.current.worker
        .getMergePlanLayer(store.current.baseId)
        .features.map(({ properties }) => [properties.featureKey, properties.outcome]),
    ),
  }),
};

createRoot(document.getElementById("root")!).render(<Harness />);
