# Merge Page Design Notes

Rules specific to the Merge page of `apps/app`. The shared design system (typography, color
tokens, spacing, primitives, map overlay primitives) lives in
[`packages/ui/DESIGN.md`](../../packages/ui/DESIGN.md); read that first.

## Merge-only components

- `OsmInputSection` — one input's section: title, file name and file actions.
  The patch section's title also holds **Swap base and patch**, which exchanges
  the inputs, or moves the only loaded one into the other slot, without
  reloading. The base and patch never hold the same file; loading or moving one
  that the other slot holds is refused with an error.
- `PlanInputs` — the input step's **Plan** section: "Merge points at identical
  coordinates automatically" (on by default; choosing Conservative turns it
  off and any other level turns it back on), "Treat every patch feature as
  new", the **Automation** level (`RadioCard`s: Conservative, Recommended by
  default, Aggressive, each with its help text), and the two entry points in
  `StepActions`: **Apply automatically** (outline) then **Review plan**
  (default). When the patch is too large to plan in the browser's heap, a
  destructive `Alert` says how much memory it needs and both actions are
  disabled. A proposal the level decided shows "Decided by <level>" in the
  review, and its first choice is the level's rule.
- `PatchIdNotice` — a warning `Alert` in the review when positive patch IDs
  replace base entities, with the count and **Treat all as new**, which
  replans.
- `PlanSummary` — features by outcome, a destructive `Alert` when the plan
  would break routing (Apply is disabled), stale decisions, demoted
  connections, and routing topology in a `Details`.
- `SuggestedChoices` — above the feature list: the groups of features that
  need a decision (MP-M7), largest first, each with its count, a line on what
  it means and **Show**, which sets the "Waiting because" filter so the list,
  the map and the bulk buttons apply to that group. **Pick nearest for N
  features** joins the bulk buttons when the shown features have a clear
  nearest. The result lists what was left out by the same groups.
- `PlanReview`, `PlanFeatureRow`, `PlanProposalActions` — one row per imported
  feature (a way with its vertices, a point, or a relation) named
  "Imported <type> <patch ID>", with its outcome, each proposal's status,
  effect and reasons (a connection or copy names its imported point or way and
  its base target, since one way's points can share a target), and a radio group per decidable proposal: **Include
  (automatic)** / **Leave out** for automatic proposals, **Decide later** /
  **Include** / **Leave out** for proposals that need review. Blocked
  proposals show reasons and no choice. A proposal that changes existing tags
  says how many ("Changes 2 tags" once in the plan, "Would change 2 tags"
  otherwise); an opened feature lists each changed key, base value then result,
  stacked, and counts the tags left unchanged. Filters (outcome, proposal kind) and
  bulk choices apply to the features shown. Each bulk button names how many
  features it would change ("Include 12,400 features") and results are counted
  in features; bulk Include skips removals and choices between competing
  proposals, and no bulk choice replaces a decision already made. Row choices
  collect in a draft, each marked "Choice not applied yet", until an `Alert`
  above the rows applies them in one replan (**Apply N choices**) or drops
  them (**Discard**); bulk buttons, export and **Apply plan** are disabled
  meanwhile. When a change to the plan fails, such as choices that cannot
  apply together, a destructive `Alert` above the rows says why, names the
  proposals, and the plan and the draft stay as they were. Selecting a
  feature on the map turns the list to its page.
- `SavedChoices` — "Your choices", below the summary: choices are saved in the
  browser for the two input files as they are applied; an `Alert` offers
  **Restore N choices** / **Discard** when the same files were reviewed
  before, and **Export choices (.json)** / **Import choices** move them
  between browsers. Restore, export and import wait while row choices are
  pending.
- `PlanMapLayer`, `PlanLegend` — imported features coloured by outcome
  (`--map-outcome-*`), with features that need a decision drawn wider and
  dashed so colour is never the only cue; clicking a feature opens its row.
  The worker draws the plan as `@osmix/plan` vector tiles from zoom 11, where
  features become selectable, so a plan of any size stays on the map.
  `PlanLegend` goes in the map legend (`OsmixMap`'s `legend`), under the dataset
  rows, pairing each colour with its outcome name and count; the sidebar keeps
  only the summary table.
  The selected feature's base targets (the base points and ways its proposals
  match) are drawn as base data: hollow points and solid lines in `--map-base`
  over a casing, each target once, with a legend row.
  While a feature is selected, both inputs fade (`OsmixMap` `fadeDatasets`), and
  the selected feature, its targets and the base ways it replaces get a
  `--map-selected` casing; their base lines sit under the plan's lines, the
  target points above them.
  When the selected feature would replace base ways, those base ways are drawn
  as base data (solid, `--map-base`, over a casing) under the plan's lines, and
  the legend adds a row for them; the row names them and the imported ways
  decided with it.
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
- **Alternatives** are competing proposals for one imported feature, such as
  several base targets for one point. Including one leaves the others out;
  **Decide later** leaves them all waiting. Alternatives outside the current
  filters stay visible on their feature's row; bulk choices still apply only
  to the features shown.
- **OSM tags** are feature attributes, such as `surface=asphalt` or
  `kerb=lowered`. Use **Copy tags** in controls; **property transfer** is the API
  term. Copying tags preserves imported geometry, including matched ways and
  their connecting nodes.
- **Connect network** is an independent choice that changes connectivity by
  rewriting included references in patch-created ways, dropping each replaced
  imported point that is untagged and no longer used. **Network attachment**
  is the API term. Changing an action must preserve the other choices on the
  same target.
- **Remove imported way** is a separate, default-off geometry change. Its
  proposal requires an equivalent retained base counterpart and verified
  retained connections, and stays blocked, with reasons, until the connections
  it needs are included. Copying tags or including a connection never includes
  it; it needs its own **Include** on its row, at every automation level, and
  no bulk choice includes it. The completed merge lists each applied removal
  with its imported and base way IDs, cleaned orphan points and connections.
- **Automatic** means the automation level included or left out a proposal;
  nothing changes until the plan is applied. Show blocked proposals with their
  reasons.
- **Leave out** applies none of a proposal's changes. The imported feature
  remains subject to the ordinary direct and exact merge rules. Saved
  decisions and APIs keep the stable value `reject`.
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

**Back to inputs** discards the plan in review; nothing has changed, and the
loaded inputs, settings and saved choices remain. **Apply automatically** stops
before applying when the plan has integrity issues and opens it in the review,
where the issues are listed. A failed automatic run returns to the inputs and
drops its plan.

A proposal's effect, removals included, always describes the current plan:
every applied choice replans, so a choice on one feature can change another
feature's proposals. Never describe a planned change as already applied, and
never apply removals automatically or in bulk.

After a successful merge, show the matching outcome before download controls. Identify it as evidence from after matching and before intersection creation. Targets, connected ways, explicit way removals, outstanding work, and retained IDs describe that stage; later intersections can add connections or remap junctions. Do not present the report as a final-reference snapshot or credit intersection effects as matching. Count actual tag-copy actions, network connections, and explicit removals separately from imported features considered for matching. Count each imported feature once regardless of its number of alternative targets. Unresolved features need attention; proposals left out on purpose are a separate category. A partially completed feature can contribute both an applied action and unresolved work. Values already present on the base are not failed copies.

Keep the completion summary prominent and concise. Provide paged details for ambiguous, blocked, unmatched, and left-out features, including selected tag values not copied to a base target and available reasons. Distinguish ordinary retained imports from explicitly removed ways and cleaned orphan points, and show replaced points a connection removed as "Replaced points removed". Below the summary, **Give new features positive IDs** (off by default) renumbers negative IDs in the downloaded PBF for tools that reject them; the report then includes the `idMap`. Keep graph diagnostics secondary; they do not prove route correctness. Show completion only after all required application and intersection stages succeed and the displayed result is refreshed. If refresh fails after application, offer a refresh-only retry and prevent advancement or reapplication until it succeeds. Retain that run's readable report until **Start a new merge** clears both input slots and the selected map state. Instruct users to reload the original base and import files to revise a completed merge; the merged result must not be reused as an implicit retry input.

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
