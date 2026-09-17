# Merge App Design Notes

Rules specific to `apps/merge`. The shared design system (typography, color
tokens, spacing, primitives, map-control CSS) lives in
[`packages/ui/DESIGN.md`](../../packages/ui/DESIGN.md); read that first.

## Merge-only components

- `MergeStepGuide` — the standard layered explanation at the top of each
  numbered merge stage.
- `StepActions` — the full-width vertical action footer for Merge workflow
  stages. It keeps long decision labels contained in the narrow sidebar.
- `AutomaticMergeProgress` — indeterminate bar + latest log message + elapsed
  timer for long worker tasks.

### Merge step actions

Use `StepActions` for navigation and processing choices at the bottom of a
Merge workflow stage. Step footers remain vertical at every sidebar width:
buttons fill the available width, labels may wrap, and long OSM terminology
must not force horizontal scrolling.

Place secondary actions first and the primary forward action last. Back, skip,
and "without" alternatives use the outline variant; preview, continue, apply,
and download actions use the default variant. Keep compact header actions,
candidate toolbars, and other non-footer controls in their existing horizontal
groups. Do not relax the global button primitive's single-line behavior to fix
a workflow-footer layout.

## Merge workflow guidance

Every merge stage must explain itself where the user makes the decision. Keep
the explanation layered so that experienced users can scan the workflow while
new users can inspect the consequences before applying anything:

1. Show one plain-language summary at the top of the numbered step card, before
   controls or results.
2. Follow it with a collapsed **How this step works** disclosure using
   `MergeStepGuide`. Do not duplicate these disclosures at individual call
   sites; add or revise the app-private guide registry instead.
3. In the expanded content, identify the inputs being read, changes that may
   occur, invariants the step preserves, and its output. Include a warning only
   when the user can make an irreversible or topology-affecting choice.
4. Reset the disclosure when moving between steps. Opening help must never
   change a form value, review decision, workflow state, or worker operation.

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
  rewriting accepted references in patch-created ways. **Network attachment**
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
- **Review each merge stage** exposes previews and checkpoints. **Run automatic
  merge** skips those checkpoints and uses only behavior explicitly configured
  for the automatic path.

Labels must state what a control changes instead of relying on a placeholder.
Put concise supporting text next to unfamiliar controls and connect it with
`aria-describedby`. Humanize internal status and reason-code values in visible
copy, but do not change the stable values used by workers or saved decisions.

### Matching evidence and accessibility

Lead with features, attributes, and connections. Explain an OSM node as a point and an OSM way as an ordered sequence of points; keep their type and ID available for identifying the exact data. A proposed match is evidence to assess, not a completed action.

Show finite distances with meters. Distinguish no eligible target within the search radius, nearby segments that cannot form a supported match, and an unavailable distance for an existing target. Never display `Infinity`, `NaN`, or a fabricated zero as a measurement. A small distance alone does not establish a safe connection.

Compare base and imported geometry using both shape and color: a base circle and solid line, an imported diamond and dashed line. Keep a visible text legend. Co-located points must remain distinguishable at their true coordinates; do not offset a marker to separate them. Coordinate evidence must come from the same highlighted geometry, with explicit Latitude and Longitude labels and selectable values. For a way, identify its start and end instead of implying a single point represents the whole geometry. Changing or clearing the comparison must update map and text together without changing matching decisions.

Associate controls with visible labels and persistent concise help through `aria-describedby`; optional popovers may add detail. Associate field errors with the relevant input and mark it invalid. Expose selection and expanded states, retain visible keyboard focus, and give evidence a named region. During a pending choice, keep eligible radios and checkboxes focusable, expose their temporary disabled state, and block repeated changes in their handlers; permanently ineligible controls remain disabled. Focus indicators must remain visible in forced-colors mode. Explain protected and routing-affecting attributes in text as well as row styling. Keep evidence and long attribute values readable at 320 px and 512 px; use stacked values when a three-column diff would force horizontal scrolling.

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

Keep the completion summary prominent and concise. Provide paged details for ambiguous, blocked, unmatched, and skipped features, including selected tag values not copied to a base target and available reasons. Distinguish ordinary retained imports from explicitly removed ways and cleaned orphan points. Keep graph diagnostics secondary; they do not prove route correctness. Show completion only after all required application and intersection stages succeed and the displayed result is refreshed. If refresh fails after application, offer a refresh-only retry and prevent advancement or reapplication until it succeeds. Retain that run's readable report until **Start a new merge** clears both input slots and the selected map state. Instruct users to reload the original base and import files to revise a completed merge; the merged result must not be reused as an implicit retry input.

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
  both 320 px and 512 px sidebar widths.

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
- Suspense fallbacks: `LoadingState`.
- Long worker tasks (merges, extracts): `TaskProgress`. Worker progress
  (`@osmix/shared` `Progress`) is `{ msg, timestamp, level }` — there is no
  numeric percentage yet, so the bar is indeterminate. If `Progress` gains a
  `percent` field, thread it into `TaskProgress` and pass a real `value`.
- Status indication: `StatusDot`, never raw `bg-green-500`/`bg-red-500`.
