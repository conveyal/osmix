# Osmix UI Design System

Conventions for the shared UI in `@osmix/ui` and every app built on it (`apps/merge`,
`apps/inspect`, and future apps). Read this before making UI changes. The component
primitives in `packages/ui/src/components/ui/` and the app-level helpers in
`packages/ui/src/components/` encode these rules — prefer using them over hand-writing
utility classes. App-specific rules live next to each app (see `apps/merge/DESIGN.md`).

## Principles

- **Dense, mono, data-first.** This is a technical GIS tool. The entire app
  renders in a monospace stack at `text-xs` with `tabular-nums` (set globally
  on `body` in `packages/ui/src/styles.css`). Information density is a feature.
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

Tokens are defined in `packages/ui/src/styles.css` (`:root` + `@theme`). The standard shadcn
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

UI primitives (`packages/ui/src/components/ui/`): `button` (cva variants + sizes),
`button-group`, `card`, `checkbox` (+ `CheckboxLabel`), `collapsible`, `dialog`,
`input`, `input-group`, `item`, `progress`, `separator`, `spinner`, `table`,
`textarea`. Built on `@base-ui/react`, styled with `cn()`/cva. All are re-exported
from the `@osmix/ui` barrel.

Shared helpers (`packages/ui/src/components/`):

- `SectionTitle` — the one uppercase-bold title style.
- `LoadingState` / `EmptyState` — the standard Suspense-fallback and
  nothing-to-show blocks. Do not hand-roll `<div className="p-2">Loading…`.
- `StatusDot` — `ok | error | warn` dot using the status tokens.
- `Details`/`DetailsSummary`/`DetailsContent` — collapsible section; the
  standard way to make a titled, togglable region. Its open-state styles target
  Base UI's `data-panel-open` attribute. Disclosure triggers remain keyboard
  accessible, and decorative chevrons are hidden from assistive technology.
- `InfoTooltip` — moves optional explanatory prose behind a compact,
  keyboard-accessible information trigger. Keep essential labels and current
  values visible.
- `ActionButton` — async button with spinner/transition handling.
- `Nav` — the top bar shell. Apps fill its `links`, `status` and `controls` slots;
  `ToggleButton` binds an icon button to a boolean atom for panel toggles.
- `Main` / `Sidebar` / `MapContent` — the page layout. `Sidebar` owns the persisted
  open state (`sidebarIsOpenAtom`) and the resize toggle.
- `ErrorBoundary` — top-level fallback; pass `onError` to route errors to a log.

When to use what:

- **Table** (`ui/table`) for key/value data and diffs. `TableCell` keeps
  `select-all` on purpose — clicking a cell selects the whole value for
  copying. Diff rows tint via `className="bg-success/10"` etc. at the call
  site.
- **Item/ItemGroup** for selectable list rows with actions (stored files,
  wizard options).
- **Card** for titled sections in the sidebar blocks.

## Tailwind sources

Tailwind v4 skips `node_modules`, so classes used inside a workspace package are
not found by automatic source detection. Each package stylesheet declares
`@source "./"` (relative to that file) and apps import the package stylesheets:

```css
@import "@osmix/ui/styles.css";
@source "./";
```

Only `@osmix/ui/styles.css` may `@import "tailwindcss"`; importing it twice
duplicates the preflight and utilities.

## Loading, progress & status

- Quick/inline waits: `Spinner`.
- Suspense fallbacks: `LoadingState`.
- Long worker tasks (merges, extracts): an indeterminate `Progress` bar plus the
  latest log message (see `AutomaticMergeProgress` in `apps/merge`). Worker progress
  (`@osmix/shared` `Progress`) is `{ msg, timestamp, level }` — there is no
  numeric percentage yet. If `Progress` gains a `percent` field, pass a real `value`.
- Status indication: `StatusDot`, never raw `bg-green-500`/`bg-red-500`.

## Map controls

- Floating panels are MapLibre custom controls (`CustomControl`) toggled by
  nav buttons via jotai atoms. Panel headers use `SectionTitle` with a border-b
  row and a ghost close/action button.
- CSS that targets MapLibre-generated DOM (`.maplibregl-ctrl`,
  `.osmix-overlay-popup`, `.osmix-overlay-tooltip`) must stay in a plain stylesheet (the app `main.css` today) —
  those elements are not rendered by React. Popup backgrounds use
  `var(--background)`.

## Future work

- **Dark mode**: add a `.dark` token block and a toggle; audit the map-marker
  white exceptions.
- **Determinate progress**: extend `@osmix/shared` `Progress` with a
  `percent?` field and surface it in the progress components.
