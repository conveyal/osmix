# Merge App Design System

Conventions for the UI in `apps/merge`. Read this before making UI changes. The
component primitives in `src/components/ui/` and the app-level helpers in
`src/components/` encode these rules — prefer using them over hand-writing
utility classes.

## Principles

- **Dense, mono, data-first.** This is a technical GIS tool. The entire app
  renders in a monospace stack at `text-xs` with `tabular-nums` (set globally
  on `body` in `src/main.css`). Information density is a feature.
- **Light theme only.** There is no dark mode. Do not add `dark:` utilities;
  they are dead code without a `.dark` token block. Dark mode is documented
  future work.
- **Tight radius.** `--radius: 0.125rem` (2px) is intentional and matches the
  utilitarian aesthetic. Do not soften per-component.
- **Semantic tokens only.** Never use raw palette utilities (`slate-*`,
  `blue-*`, `green-*`, `red-*`, …). Use the tokens below.

## Typography

The body is `text-xs` mono; hierarchy comes from weight and case, not size.

| Role                      | Style                                              | Where it lives                                 |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| Body / data / table cells | inherited `text-xs`, `font-normal`                 | global `body` style                            |
| Section title             | `font-bold uppercase tracking-wide` (inherited xs) | `SectionTitle`, `CardHeader`, `DetailsSummary` |
| Dialog title              | `text-sm font-bold uppercase tracking-wide`        | `DialogTitle`                                  |
| Muted / meta              | `text-muted-foreground` (no size change)           | anywhere                                       |

Rules:

- Never hand-set a text-size class for body text. `text-sm` appears exactly
  once in the app (DialogTitle).
- Never hand-write `font-bold uppercase` — render titles through
  `SectionTitle`, `CardHeader`, or `DetailsSummary`.
- Write title strings in normal sentence case ("Merge steps", not
  "MERGE STEPS"); the CSS `uppercase` transform handles display. This keeps
  screen readers from spelling out letters.

## Color

Tokens are defined in `src/main.css` (`:root` + `@theme`). The standard shadcn
set (`background`, `foreground`, `card`, `muted`, `accent`, `primary`,
`destructive`, `border`, …) plus three app additions:

| Token                      | Meaning                               | Examples                                                                           |
| -------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| `--success` (≈ green-500)  | Positive status, created/added things | `StatusDot status="ok"`, `text-success` diff additions, `bg-success/10` added rows |
| `--warning` (≈ amber-500)  | Caution, modified things              | `text-warning`, `bg-warning/10` modified rows                                      |
| `--info` (≈ blue-500)      | Active/selected state, links, routes  | `text-info` nav active + links, `bg-info/5 border-info/30` active item             |
| `--destructive` (existing) | Errors, deleted things                | `StatusDot status="error"`, `text-destructive`, `bg-destructive/10` removed rows   |

Conventions:

- Opacity variants express surfaces: `/10` for diff-row backgrounds, `/5` for
  active-selection backgrounds, `/20`–`/60` for tinted borders.
- Grays come from tokens: `bg-muted` (sidebar chrome), `bg-muted/50` (inset
  panels like the activity log), `text-muted-foreground` (secondary text),
  `hover:bg-accent` (hover states).
- Allowed exception: elements drawn on top of map imagery (e.g. the extract
  bbox corner markers use `border-white`) may use literal white for contrast
  against tiles.

## Spacing & layout

- The base spacing unit inside cards and panels is `p-2` / `gap-2`. Sidebar
  and nav step up responsively (`p-2 lg:p-4`).
- **Card owns its padding.** `CardHeader` is `px-2 py-1.5 min-h-8 border-b`;
  `CardContent` defaults to `p-2`. Pass `className="p-0"` to `CardContent` for
  flush content (tables, `Details` sections, item lists). Never add padding
  wrappers inside a header.
- Collapsible triggers (`DetailsSummary`, the activity-log trigger) are
  `p-2 h-8`.
- Prefer flex + `gap-*` over margins and over `space-y-*`.

## Components

UI primitives (`src/components/ui/`): `button` (cva variants + sizes),
`button-group`, `card`, `checkbox` (+ `CheckboxLabel`), `collapsible`,
`command`, `dialog`, `input`, `input-group`, `item`, `progress`, `separator`,
`spinner`, `table`, `textarea`. Built on `@base-ui/react`, styled with
`cn()`/cva.

App-level helpers (`src/components/`):

- `SectionTitle` — the one uppercase-bold title style.
- `LoadingState` / `EmptyState` — the standard Suspense-fallback and
  nothing-to-show blocks. Do not hand-roll `<div className="p-2">Loading…`.
- `StatusDot` — `ok | error | warn` dot using the status tokens.
- `TaskProgress` — indeterminate bar + latest log message + elapsed timer for
  long worker tasks.
- `Details`/`DetailsSummary`/`DetailsContent` — collapsible section; the
  standard way to make a titled, togglable region.
- `InfoTooltip` — moves optional explanatory prose behind a compact,
  keyboard-accessible information trigger. Keep essential labels and current
  values visible.
- `MergeStepGuide` — the standard layered explanation at the top of each
  numbered merge stage.
- `StepActions` — the full-width vertical action footer for Merge workflow
  stages. It keeps long decision labels contained in the narrow sidebar.
- `ActionButton` — async button with spinner/transition handling.

When to use what:

- **Table** (`ui/table`) for key/value data and diffs. `TableCell` keeps
  `select-all` on purpose — clicking a cell selects the whole value for
  copying. Diff rows tint via `className="bg-success/10"` etc. at the call
  site.
- **Item/ItemGroup** for selectable list rows with actions (stored files,
  wizard options).
- **Card** for titled sections in the sidebar blocks.

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
- **Imported-data matching** is the optional proximity workflow. **Property
  transfer** copies only selected tag values; **network attachment** rewrites
  only accepted references in patch-created ways.
- **Intersection creation** connects compatible same-grade crossings while
  leaving ambiguous and grade-separated crossings disconnected.
- **Review each merge stage** exposes previews and checkpoints. **Run automatic
  merge** skips those checkpoints and uses only behavior explicitly configured
  for the automatic path.

Labels must state what a control changes instead of relying on a placeholder.
Put concise supporting text next to unfamiliar controls and connect it with
`aria-describedby`. Humanize internal status and reason-code values in visible
copy, but do not change the stable values used by workers or saved decisions.

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
Worker lifecycle and restart tests run after Merge UI tests so their intensive
Web Worker activity cannot compete with MapLibre rendering or PBF parsing on a
small CI runner.

## Loading, progress & status

- Quick/inline waits: `Spinner`.
- Suspense fallbacks: `LoadingState`.
- Long worker tasks (merges, extracts): `TaskProgress`. Worker progress
  (`@osmix/shared` `Progress`) is `{ msg, timestamp, level }` — there is no
  numeric percentage yet, so the bar is indeterminate. If `Progress` gains a
  `percent` field, thread it into `TaskProgress` and pass a real `value`.
- Status indication: `StatusDot`, never raw `bg-green-500`/`bg-red-500`.

## Map controls

- Floating panels are MapLibre custom controls (`CustomControl`) toggled by
  nav buttons via jotai atoms. Panel headers use `SectionTitle` with a border-b
  row and a ghost close/action button.
- CSS that targets MapLibre-generated DOM (`.maplibregl-ctrl`,
  `.osmix-overlay-popup`, `.osmix-overlay-tooltip`) must stay in `main.css` —
  those elements are not rendered by React. Popup backgrounds use
  `var(--background)`.

## Future work

- **Dark mode**: add a `.dark` token block and a toggle; audit the map-marker
  white exceptions.
- **Determinate progress**: extend `@osmix/shared` `Progress` with a
  `percent?` field and surface it in `TaskProgress`.
