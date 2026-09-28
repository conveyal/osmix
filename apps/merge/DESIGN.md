# Merge App Design Notes

Rules specific to `apps/merge`. The shared design system (typography, color
tokens, spacing, primitives, map overlay primitives) lives in
[`packages/ui/DESIGN.md`](../../packages/ui/DESIGN.md); read that first.

## Merge-only components

- `PlanInputs` — the input step's **Plan** section: "Merge points at identical
  coordinates automatically" (on by default), "Treat every patch feature as
  new", and the two entry points in `StepActions`: **Apply automatically**
  (outline) then **Review plan** (default).
- `PatchIdNotice` — a warning `Alert` in the review when positive patch IDs
  replace base entities, with the count and **Treat all as new**, which
  replans.
- `PlanSummary` — features by outcome, a destructive `Alert` when the plan
  would break routing (Apply is disabled), stale decisions, demoted
  connections, and routing topology in a `Details`.
- `PlanReview`, `PlanFeatureRow`, `PlanProposalActions` — one row per imported
  feature (a way with its vertices, a point, or a relation) named
  "Imported <type> <patch ID>", with its outcome, each proposal's status,
  effect and reasons, and a radio group per decidable proposal: **Include
  (automatic)** / **Leave out** for automatic proposals, **Decide later** /
  **Include** / **Leave out** for proposals that need review. Blocked
  proposals show reasons and no choice. Filters (outcome, proposal kind) and
  bulk choices apply to the features shown; bulk Include skips proposals with
  alternatives.
- `PlanMapLayer`, `PlanLegend` — imported features coloured by outcome
  (`--map-outcome-*`), with features that need a decision drawn wider and
  dashed so colour is never the only cue; clicking a feature opens its row.
  `PlanLegend` goes in the map legend (`OsmixMap`'s `legend`), under the dataset
  rows, pairing each colour with its outcome name and count; the sidebar keeps
  only the summary table.
- `MergeResult` — the result step: the completion summary, the merged dataset
  section, routing topology, positive IDs, and downloads.
- `StepActions` — the full-width vertical action footer for Merge workflow
  stages. It keeps long decision labels contained in the sidebar.

### Merge step actions

Use `StepActions` for navigation and processing choices at the bottom of a
Merge workflow stage. Step footers remain vertical at every sidebar width:
buttons fill the available width, labels may wrap, and long OSM terminology
must not force horizontal scrolling.

Place secondary actions first and the primary forward action last. Back and
download actions use the outline variant; apply and review use the default
variant.

## Merge workflow guidance

The workflow has three steps: **Choose the inputs**, **Review the plan**, and
**Merged result**; **Apply automatically** replaces the review with one task
whose steps are Plan merge, Apply plan and Refresh result. Each step opens with
the shared `Step` section and one plain-language sentence, followed by the
step's notices (the Inspect hint, the patch ID notice). Nothing changes until
the plan is applied; say so in the review.

Use the merge terms consistently:

- **Base OSM** is the authoritative existing dataset whose identity and
  untouched geometry are preserved unless a same-ID patch update explicitly
  replaces them.
- **Patch OSM** contains imported additions and updates.
- **Direct merge** adds patch-only entities and applies same-ID updates.
- **Exact reconciliation** combines different IDs only when their serialized
  coordinates or ordered geometry and routing context agree.
- **Imported-data matching** is the optional proximity workflow. A **candidate**
  proposes a correspondence; it does not select every eligible action.
- **Alternative targets** belong together under their imported feature. Show
  at most one selected target and an explicit **Leave unmatched** choice.
  Choosing a target selects its eligible configured copying and connection actions;
  removal requires its own explicit choice. Independent action controls can refine
  the selection. Keep eligible actions available on unselected
  alternatives: selecting one switches the target using that action choice.
  Replacing a target preserves other imported features' decisions. Use the group's
  **Leave unmatched** control to clear its choice, rather than per-alternative
  **Skip match** controls. Keep alternatives outside current filters visible as
  labeled context; bulk actions still apply only to matching rows.
- **OSM tags** are feature attributes, such as `surface=asphalt` or
  `kerb=lowered`. Use **Copy tags** in controls; **property transfer** is the API
  term. Copying tags preserves imported geometry, including matched ways and
  their connecting nodes.
- **Connect network** is an independent choice that changes connectivity by
  rewriting accepted references in patch-created ways, dropping each replaced
  imported point that is untagged and no longer used. **Network attachment**
  is the API term. Changing an action must preserve the other choices on the
  same target.
- **Remove imported way** is a separate, default-off geometry change. It requires
  an equivalent retained base counterpart and verified retained connections;
  copying attributes or choosing a target must never schedule it. Show the exact
  imported/base way IDs, affected branches, accepted connection prerequisites,
  and orphan-node cleanup before selection and in the generated preview before
  application. Explain that remaining attributes leave with the removed way and
  that copying selected attributes is a separate choice. If removal is blocked,
  explain how to review the required connection or keep the imported geometry.
- **Scheduled** describes what the current choices include in the next
  matching preview. Applying that preview is a separate step. **Automatic** means scheduled by the matching rules; it
  never means already applied. Keep discovery eligibility distinct from the
  actions currently scheduled, and show blocked actions with their reasons.
- **Skip match** schedules no matching actions. Imported additions remain
  subject to the ordinary direct/exact merge rules. Use **Skipped** for the
  user-facing status while retaining `rejected` in saved decisions and APIs.
- **Intersection creation** connects compatible same-grade crossings while
  preserving existing shared junctions, including bridge and tunnel entrances.
  New grade-separated interior crossings remain disconnected, and unsafe
  shared-junction substitutions leave the original connections unchanged.
- **Review plan** plans the merge and stops for decisions; **Apply
  automatically** plans and applies in one run, leaving out proposals that need
  a decision. Both use the same plan and validation.
- **Plan**, **proposal**, **outcome**: a plan lists every change a merge would
  make, as proposals grouped by imported feature; a feature's outcome is its
  headline (Needs decision, Removed, Merged, Connected, Replaced, Added,
  Unchanged). **Include** and **Leave out** decide a proposal; **Decide later**
  leaves it waiting.

Labels must state what a control changes instead of relying on a placeholder.
Put concise supporting text next to unfamiliar controls and connect it with
`aria-describedby`. Humanize internal status and reason-code values in visible
copy, but do not change the stable values used by workers or saved decisions.

### Matching evidence and accessibility

Lead with features, attributes, and connections. Explain an OSM node as a point and an OSM way as an ordered sequence of points; keep their type and ID available for identifying the exact data. A proposed match is evidence to assess, not a completed action.

Show finite distances with meters. Distinguish no eligible target within the search radius, nearby segments that cannot form a supported match, and an unavailable distance for an existing target. Never display `Infinity`, `NaN`, or a fabricated zero as a measurement. A small distance alone does not establish a safe connection.

Compare base and imported geometry using both shape and color: a base circle and solid line, an imported diamond and dashed line. Keep a visible text legend. Co-located points must remain distinguishable at their true coordinates; do not offset a marker to separate them. Coordinate evidence must come from the same highlighted geometry, with explicit Latitude and Longitude labels and selectable values. For a way, identify its start and end instead of implying a single point represents the whole geometry. Changing or clearing the comparison must update map and text together without changing matching decisions.

Associate controls with visible labels and persistent concise help through `aria-describedby`; optional popovers may add detail. Match filters and the completion summary's pickers use `NativeSelect` with a `<label htmlFor>`; a filter's "All …" option has the empty value and clears that filter. Associate field errors with the relevant input and mark it invalid. Expose selection and expanded states, retain visible keyboard focus, and give evidence a named region. During a pending choice, keep eligible radios and checkboxes focusable, expose their temporary disabled state, and block repeated changes in their handlers; permanently ineligible controls remain disabled. Focus indicators must remain visible in forced-colors mode. Explain protected and routing-affecting attributes in text as well as row styling. Keep evidence and long attribute values readable at 448 px and 512 px (the sidebar widths at 1024px and 1280px windows); use stacked values when a three-column diff would force horizontal scrolling.

Provide **Back to matching** from reconciliation, failed cumulative generation,
and the cumulative matching preview before application. Returning preserves the
loaded original inputs, options, and saved decisions. Show the affected imported
feature when a decision conflict needs correction. After changes are applied,
intersection recovery must not imply a return to the original matching state.

Removal previews belong to the generated changeset and become stale when any
matching decision changes, including a connection on another page. Clear stale
preview evidence and require regeneration before application. Never describe a
scheduled removal as already applied, and never provide automatic or bulk removal.

After a successful merge, show the matching outcome before download controls. Identify it as evidence from after matching and before intersection creation. Targets, connected ways, explicit way removals, outstanding work, and retained IDs describe that stage; later intersections can add connections or remap junctions. Do not present the report as a final-reference snapshot or credit intersection effects as matching. Count actual tag-copy actions, network connections, and explicit removals separately from imported features considered for matching. Count each imported feature once regardless of its number of alternative targets. Unresolved features need attention; intentional skips are a separate category. A partially completed feature can contribute both an applied action and unresolved work. Values already present on the base are not failed copies.

Keep the completion summary prominent and concise. Provide paged details for ambiguous, blocked, unmatched, and skipped features, including selected tag values not copied to a base target and available reasons. Distinguish ordinary retained imports from explicitly removed ways and cleaned orphan points, and show replaced points a connection removed as "Replaced points removed". Below the summary, **Give new features positive IDs** (off by default) renumbers negative IDs in the downloaded PBF for tools that reject them; the report then includes the `idMap`. Keep graph diagnostics secondary; they do not prove route correctness. Show completion only after all required application and intersection stages succeed and the displayed result is refreshed. If refresh fails after application, offer a refresh-only retry and prevent advancement or reapplication until it succeeds. Retain that run's readable report until **Start a new merge** clears both input slots and the selected map state. Instruct users to reload the original base and import files to revise a completed merge; the merged result must not be reused as an implicit retry input.

`Details` is the shared disclosure primitive. Its open-state styles target Base
UI's `data-panel-open` attribute. Disclosure triggers remain keyboard
accessible, and decorative chevrons are hidden from assistive technology.

### Explanatory diagrams

Use a compact SVG only when topology or data flow is materially clearer as a
picture. Merge diagrams follow these constraints:

- Provide a fixed `viewBox` and responsive `width: 100%`; never give the SVG a
  fixed rendered width that can overflow the sidebar.
- Give each diagram an accessible name and description with React
  `useId()`-backed `<title>` and `<desc>` elements.
- Use semantic foreground, muted, info, success, warning, destructive, and
  border tokens. Never encode meaning by color alone: pair colors with labels,
  shapes, or solid/dashed line styles.
- Set connector strokes to `vector-effect="non-scaling-stroke"` so they remain
  legible at narrow widths.
- Avoid animation and `<foreignObject>`. SVG text must remain understandable at
  both 448 px and 512 px sidebar widths.

### Browser test boundaries

Keep the real Monaco Merge journey focused on integration behavior that needs
an actual parsed OSM and worker-backed merge. Load each input once, verify its
real metadata, and advance through the workflow without repeating presentation
checks that can run against production components in the lightweight guidance
harness.

Use that harness for responsive geometry, long-label and long-filename
containment, accessible control names, and controlled action-state transitions.
Run the real Merge journey, guidance harness, and worker-runtime coverage as
ordered Playwright projects. This prevents additional Chromium contexts or
intensive Web Worker activity from competing with MapLibre rendering and PBF
parsing on a small CI runner. The real journey uses one app worker; the
dedicated worker-runtime project retains single-worker, multi-worker,
replication, recovery, and disposal coverage.

## Loading, progress & status

- Quick/inline waits: `Spinner`.
- Suspense fallbacks and transitions: `LoadingState` ("Please wait…").
- Every merge operation (planning, a decision, applying, the automatic run) is
  a top-level task (`Tasks.run` / `Tasks.start` from
  `@osmix/app-core`), so it gets a task toast (progress, then its outcome) and
  shows in Activity. Only one runs at a time: the stage buttons read
  `useTaskLock()`. Sub-work is a step (`task.step` / `task.runStep`).
- The automatic workflow is one task with the steps Plan merge, Apply plan and
  Refresh result; its toast and Activity carry progress. Cancel stops it only
  before the plan is applied.
- Status indication: `StatusDot`, never raw palette colors.
- Merge notices, recovery prompts and failures use `Alert` (`destructive` for
  failures that need action; `warning` for irreversible choices such as way
  removal).
