# Osmix UI Design System

These are the conventions for `@osmix/ui`, `@osmix/app-components`, and the app built on them (`apps/app`: Home and the Merge, Inspect and Extract pages). Read this before you make UI changes. Merge-specific rules are in `apps/app/DESIGN.md`.

The design rules are kept in three places, in this order of strength:

1. **The theme is closed.** `packages/ui/src/styles.css` resets Tailwind's default palette, shadows, font sizes and font families. Only the tokens below produce CSS.
2. **Primitives own styling.** Colour, type, radius, elevation and focus are set inside the components in `packages/ui` (and the map components in `packages/app-components`). Call sites compose them and add layout.
3. **Lint enforces the rest.** `pnpm run lint:check` runs the rules in the [enforcement map](#enforcement-map). A rule marked "advisory" depends on review.

## Theme: cartographic instrument

Osmix is a dense, technical GIS tool. The theme looks like a survey instrument on paper:

- warm paper neutrals and warm-ink text
- one signature accent, survey orange (`--brand`)
- the map is the main subject

The design choices:

- **Light only.** Tokens are the only colour source, so a future dark theme only redefines them (in a `.dark` block). Do not use `dark:` utilities.
- **Square corners.** `--radius` is `0.125rem` (2px). Do not soften corners per component.
- **Dense.** The body is `text-xs` with `tabular-nums`. Hierarchy comes from weight, case and the typeface, not from size.

## Tokens

### Color

| Token                           | Use                                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background`                    | The page (paper)                                                                                                                                                                  |
| `card`, `popover`               | The sidebar (the reading surface), dialogs, menus and the nav                                                                                                                     |
| `foreground`                    | Ink                                                                                                                                                                               |
| `muted`, `muted-foreground`     | The map frame and the current row in a sidebar list; secondary text                                                                                                               |
| `accent`                        | Hover backgrounds                                                                                                                                                                 |
| `primary`, `primary-foreground` | Primary buttons (ink)                                                                                                                                                             |
| `secondary`                     | Secondary buttons                                                                                                                                                                 |
| `border`, `input`               | Rules and field borders                                                                                                                                                           |
| `brand` (survey orange)         | The brand mark, the focus ring, progress bars, step numbers and bbox marks. It is **never** a status colour                                                                       |
| `app` (`--app-hue`)             | The per-page hue: Merge violet, Inspect teal, Extract magenta (Home: brand). Only for the nav brand mark and the active page link. `OsmixAppShell` sets `data-app` from the route |
| `success`                       | Added, OK                                                                                                                                                                         |
| `warning`                       | Modified                                                                                                                                                                          |
| `info`                          | Selected, active, links                                                                                                                                                           |
| `destructive`                   | Deleted, errors                                                                                                                                                                   |
| `overlay`                       | Dialog backdrop                                                                                                                                                                   |
| `white`, `black`                | Only for marks drawn on top of map imagery                                                                                                                                        |

Opacity steps:

| Step  | Use                                                    |
| ----- | ------------------------------------------------------ |
| `/5`  | Active selection (`bg-info/5`) and `Alert` backgrounds |
| `/10` | Diff-row backgrounds (`bg-success/10`)                 |
| `/40` | Tinted borders                                         |

### Map colors

MapLibre can't read CSS variables or `oklch()`. So layer paint gets its colours from `useMapColors()` in `@osmix/app-components`. That hook resolves the `--map-*` tokens to `rgb()` strings. Never write a colour literal in paint.

| Role                   | Token                               | Look                                                                                                  |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `base`                 | `--map-base` (ink)                  | The base or only dataset. Solid lines, circle nodes                                                   |
| `patch`                | `--map-patch` (brand)               | Imported / patch data. Dashed lines, diamond nodes                                                    |
| `hover`                | `--map-hover`                       | The hovered feature                                                                                   |
| `selected`             | `--map-selected` (info)             | The selected feature, drawn over a `casing`                                                           |
| `casing`               | `--map-casing` (white)              | The outline under highlighted lines                                                                   |
| `route` / `routeError` | `--map-route` / `--map-route-error` | Routes, and unreachable legs                                                                          |
| `bbox`                 | `--map-bbox` (brand)                | The extract bounding box, and the long-dashed outline of the selected file's header bounds in Extract |

The overlay draws patch ways and outlines with `line-dasharray: [1.2, 0.8]` (in line widths: short dashes, tight gaps, so even a short imported way reads as dashed) and the legend symbol uses the same ratio. Diamond nodes appear in the comparison markers and the legend (`MapRoleSymbol`); overlay nodes are circles for both roles, because a MapLibre `circle` layer cannot draw diamonds. Extract's file-bounds outline uses a longer dash (`[6, 3]`) so it never reads as patch data.

Below `MIN_PICKABLE_ZOOM` the raster preview draws both roles with solid lines; dashes exist only in the vector layers.

The default basemap is Voyager (`carto-voyager`) with labels on and roads off: enough colour to read the place, quiet enough that data and status colours stand out. The style, labels and roads switch from the map's Basemap menu, and the choice persists as `basemapPresetAtom` (`@osmix/app-core`); nothing else about the map overlay persists.

### Type

| Role                                                          | Style                                                   | Where it lives                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Body, UI copy                                                 | IBM Plex Sans, `text-xs`                                | `body`                                                                   |
| Data: IDs, tags, coordinates, file names, table cells, inputs | IBM Plex Mono                                           | `TableCell`, `Input`, `MapPanelHeader` detail; `font-mono` at call sites |
| Section title                                                 | Plex Mono, bold, uppercase, `tracking-wider`            | `SectionTitle`, `DetailsSummary`, `TableHead`                            |
| Sidebar section and step title                                | Plex Mono, bold, uppercase, `tracking-wider`, `text-sm` | `SidebarSection`, `Step`                                                 |
| Dialog title                                                  | `text-sm font-semibold`, sentence case                  | `DialogTitle`                                                            |
| Emphasis                                                      | `font-semibold` or `font-medium`                        | call sites                                                               |

Only two sizes exist: `text-xs` (the body default) and `text-sm` (set inside primitives). Write every string in sentence case. CSS uppercases section titles, and screen readers then read words instead of spelling out letters.

### Elevation, radius and focus

- **Flat:** the sidebar has no boxes. Sections are separated by a divider, and content sits on the sidebar surface. Separate things in this order: spacing first, then a divider (`border-b`, `divide-y`), then a raised surface only for the one thing that must stand out (an `Alert`, the current row). Never put a bordered box inside another.
- **Raised (`shadow-raised`):** the nav and `MapPanel` panels.
- **Modal (`shadow-modal`):** dialogs, sheets, popovers and menus.
- **Radius:** `rounded-sm` to `rounded-xl` scale from `--radius`. Primitives choose it.
- **Focus:** the `focus-ring` utility (a 2px brand outline, and `CanvasText` in forced-colors mode). It is hidden while a native picker is `:open`, because macOS draws the menu translucent and the ring would show through it. Every interactive primitive applies it. Never hand-write `ring-*` focus styles.

## Supported viewports

The app and its Inspect, Merge and Extract pages are map-focused and desktop-only. They support windows **1024px (64rem) wide and wider** and nothing narrower.

- **Below 1024px**, `OsmixAppShell` shows `SmallWindowAlert`: a warning `Alert` (`shape="banner"`) under the nav that can't be dismissed and doesn't block the app. It uses CSS alone (the `small-window-only` utility in `styles.css`), so it never renders or announces on wider windows. Phones keep `width=device-width` and see it too.
- **Style for the desktop.** Don't add `sm:`, `md:`, `lg:`, `max-*:` or `min-[…]:` variants, phone layouts, or JS viewport checks. `xl:` (1280px) is allowed for extra room on wide windows, as the sidebar width does (28rem, 32rem from 80rem).
- **Measure containers, not the window.** A layout that must adapt to the space it's given (the inspector's dock, above) measures its own element, like `MapOverlay` does with `ResizeObserver`.
- There's no minimum height.

## Components

Primitives come from `@osmix/ui`. Map components come from `@osmix/app-components`.

| Need                                             | Use                                                                                                                                                                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page layout                                      | `Main`, `AppSidebar`, `MapContent`                                                                                                                                                                                   | shadcn `Sidebar` below the nav: offcanvas collapse (nav trigger, edge rail, ⌘B), open state persisted, positioned inside `Main` so nothing above the row sits under it. It owns the scroll; children are flush to its edges, so its direct children are `SidebarSection`s and `Step`s. Loose content (a trailing action row) gets `p-inset`                                                                               |
| App root and nav                                 | `OsmixAppShell`                                                                                                                                                                                                      | Renders the sidebar provider, the tooltip provider, the task lock, toasts, the Activity sheet and the standard nav (`OsmixNav`: the brand links Home, the page links use the router), and sets the page hue from the route                                                                                                                                                                                                |
| Page without the map (Home)                      | `FullPage` (`title`, `lead`, `footer`), `FeatureSection` (`title`, `action`, `features`, `status`)                                                                                                                   | `FullPage` covers the sidebar and map row, which stay mounted below it; give the shared `OsmixMap` `active={false}` so its toolbar leaves the nav. `FeatureSection`s are flat and divided, like sidebar sections; the action is a link styled with `buttonVariants({ variant: "outline" })`                                                                                                                               |
| Workflow step                                    | `Step` (`number`, `title`, `action`)                                                                                                                                                                                 | A `SidebarSection` that renders "1." in brand before the title. Omit `number` for unnumbered steps                                                                                                                                                                                                                                                                                                                        |
| Sidebar section                                  | `SidebarSection` (`title`, `action`, `flush`)                                                                                                                                                                        | Flat and edge to edge with one `border-b`; the title row holds `action` (icon buttons). The body is `px-inset pb-inset` with `gap-2`. `flush` drops that padding for tables, `Details` and divided lists; give flush children `px-inset` or `p-inset`. A reusable block that goes inside a section (`StoredOsmList`, `OsmSourceLinks`, `RoutingTopology`) has no frame of its own; the caller's section titles it         |
| Collapsible section                              | `Details`, `DetailsSummary`, `DetailsContent`                                                                                                                                                                        | The chevron rotates on `data-panel-open`. The summary draws its own dividers, so use it in a `flush` section body                                                                                                                                                                                                                                                                                                         |
| Heading inside a panel                           | `SectionTitle`                                                                                                                                                                                                       | Never hand-write `font-bold uppercase`                                                                                                                                                                                                                                                                                                                                                                                    |
| Callout (notice, warning, failure, confirmation) | `Alert` (`variant`, `title`, `action`, `shape`)                                                                                                                                                                      | `destructive` has `role="alert"`. `shape="banner"` is a full-width strip for app-level notices (`SmallWindowAlert`)                                                                                                                                                                                                                                                                                                       |
| Key/value data, diffs                            | `Table`                                                                                                                                                                                                              | `TableCell` is mono and `select-all` on purpose. Pass `numeric` to `TableCell` and its `TableHead` for a column of numbers                                                                                                                                                                                                                                                                                                |
| List rows                                        | `Item`, `ItemGroup`                                                                                                                                                                                                  | In a sidebar list use `variant="row"`: no box, a divider between rows, `px-inset`, and the `muted` tint when `aria-current` marks the current row. `outline` has a real border for rare standalone items. An expandable row (the duplicate changes list) shows its detail below the header only while it is the current row, so one row is open at a time                                                                 |
| Buttons                                          | `Button` (`default` = ink primary, `outline`, `secondary`, `ghost`, `destructive`, `link`)                                                                                                                           | Default height `h-8` matches inputs and selects; `sm` (`h-7`) is for compact secondary actions. `buttonVariants()` styles a non-button trigger. Show one ink (`default`) button at a time: the next step. Until a dataset is loaded that is **Open file** (`OsmPbfSelectFileButton`); other ways in (Open from URL, the Monaco example) are ghost or outline, and the load profile sits behind `OsmLoadProfileDisclosure` |
| Async buttons                                    | `ActionButton`                                                                                                                                                                                                       | Shows a spinner and a pending state; disabled while any task runs. Icon-only: pass `label` + `icon`                                                                                                                                                                                                                                                                                                                       |
| Icon-only button                                 | `IconButton` (`label`, `icon`)                                                                                                                                                                                       | `label` becomes the `aria-label` and a `Tooltip`; `render={<a …/>}` for icon links                                                                                                                                                                                                                                                                                                                                        |
| Short label on hover                             | `Tooltip`, `TooltipTrigger`, `TooltipContent`                                                                                                                                                                        | `IconButton` uses it; `TooltipProvider` is mounted by `OsmixAppShell`                                                                                                                                                                                                                                                                                                                                                     |
| Labelled control                                 | `Field` (`orientation` vertical or horizontal), `FieldLabel`, `FieldContent`, `FieldDescription`                                                                                                                     | No box or tint around a field. Horizontal fields put the label and help text beside the control, as in the load profile                                                                                                                                                                                                                                                                                                   |
| Text field                                       | `Input`, `InputGroup`                                                                                                                                                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Action menu                                      | `Menu`, `MenuTrigger` or `MenuIconTrigger`, `MenuContent`, `MenuItem`, `MenuCheckboxItem`, `MenuRadioGroup` + `MenuRadioItem`, `MenuGroup` + `MenuGroupLabel`, `MenuSeparator`                                       | The trigger takes `Button` variants; `MenuIconTrigger` (`label`, `icon`) is the icon-only trigger with a name and a tooltip. Check and radio items keep the menu open                                                                                                                                                                                                                                                     |
| Floating panel                                   | `Popover`, `PopoverIconTrigger` (`label`, `icon`), `PopoverContent` (`align`, `finalFocus`)                                                                                                                          | For a tool that needs more than a menu (the map search). Non-modal; it owns Esc, outside clicks and focus return                                                                                                                                                                                                                                                                                                          |
| Dropdown                                         | `NativeSelect` + `NativeSelectOption`                                                                                                                                                                                | A themed native `<select>`: native keyboard, typeahead and mobile pickers. `className` sets the wrapper width (`w-full` to fill)                                                                                                                                                                                                                                                                                          |
| Mutually exclusive options                       | `Radio` + `RadioLabel` or `RadioCard`, in a `<fieldset>`                                                                                                                                                             | A themed native radio: arrow keys and focus stay native                                                                                                                                                                                                                                                                                                                                                                   |
| Checkbox                                         | `Checkbox` + `CheckboxLabel`                                                                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Pagination                                       | `Pager` (`page` is zero-based)                                                                                                                                                                                       | Renders nothing for a single page                                                                                                                                                                                                                                                                                                                                                                                         |
| Optional explanation                             | `InfoTooltip`                                                                                                                                                                                                        | Keep essential labels visible                                                                                                                                                                                                                                                                                                                                                                                             |
| Nothing to show                                  | `EmptyState`                                                                                                                                                                                                         | One sentence, no trailing period                                                                                                                                                                                                                                                                                                                                                                                          |
| Waiting                                          | `Spinner` (inline), `LoadingState` (a section or Suspense), `Progress` (long worker tasks, with `value={null}` for indeterminate)                                                                                    | Never text alone. Timed work shows `ElapsedTimer`                                                                                                                                                                                                                                                                                                                                                                         |
| Task progress and outcome                        | Toasts (`Toaster`, `showToast`), raised by `TaskToasts` in the shell                                                                                                                                                 | See [Tasks and activity](#tasks-and-activity). Don't call `showToast` for task progress or outcomes yourself                                                                                                                                                                                                                                                                                                              |
| Task history row                                 | `ActivityItem`, `ActivityMessage`, `ActivityError`                                                                                                                                                                   | Used by the Activity sheet                                                                                                                                                                                                                                                                                                                                                                                                |
| Status                                           | `StatusDot` (`ok`, `warn`, `error`)                                                                                                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Dialog                                           | `Dialog`, `DialogContent`, `DialogTitle`, …                                                                                                                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Map overlay                                      | `OsmixMap` (`datasets`, `tools`, `legend`), `MapOverlay`, `MapPanel` (`width="narrow"`, `"default"` or `"auto"`), `MapPanelHeader` (`icon`, `title`, `detail`, `actions`), `MapToolbar`, `MapInspector`, `MapLegend` | Apps render `OsmixMap`; it mounts the inspector and legend, and portals the toolbar into the nav. See [Map overlay](#map-overlay)                                                                                                                                                                                                                                                                                         |
| Map paint colours                                | `useMapColors()`                                                                                                                                                                                                     | See [Map colors](#map-colors)                                                                                                                                                                                                                                                                                                                                                                                             |

### Spacing and sizing

- **Inset (`--spacing-inset`, 12px):** the padding from every edge-aligned surface to its content: `SidebarSection`, `DetailsSummary`, list rows, table first and last cells, `EmptyState`, `LoadingState`, `Alert`, `MapPanelHeader` and dialogs. There is one inset between the sidebar edge and any text; nested frames never add a second. Children of flush content use `p-inset` or `px-inset`, so text lines up with the title above it.
- **Rhythm:** `gap-2` between items inside a surface.
- **Control height:** `h-8` for buttons, inputs and selects, so mixed rows line up.
- **Lists in prose:** `list-decimal pl-4` or `list-disc pl-4` (markers outside), never `list-inside`.

### Nav

The nav is `--header-height` (2.5rem) tall with a `gap-3` rhythm. Left: the sidebar trigger, the brand, a `NavSeparator` and the app links (the current app is underlined on the nav's bottom edge in its hue). Right: the map tools (the toolbar `OsmixMap` portals in; see [Map overlay](#map-overlay)), `controls` (empty by default), a `NavSeparator`, "Check system" and the GitHub link, then a `NavSeparator` and `trailing`: the Activity button, the last item. The nav shows no running work; that is the task toast's job.

### Map overlay

The sidebar is the workflow; the map is the canvas, kept as clear as possible. Each map corner has one job: the inspector top-left, task toasts top-right, the legend bottom-left, and MapLibre's scale and attribution bottom-right. Map-wide tools live in the nav. `OsmixMap` places three things through `MapOverlay`, each with one slot and one show rule:

- **Toolbar** (in the nav): the map center ("lon, lat" to four decimals, selectable), zoom out, the zoom level ("z8.28"), zoom in, "Fit map to all data", then "Open map search", the Basemap menu, and "Route between two points" only where the app passes `tools={{ routing: true }}` (Inspect). `MapOverlay` portals it into the nav's map-tools slot (`useNavToolsAnchor`), so it keeps the map and overlay contexts; the slot hides while empty. The search opens as a `Popover` under its button, right-aligned; it owns Esc and focus return, and an entity result sends focus to the inspector title instead.
- **Inspector**: shown only while an entity is selected or the routing tool is active. When the map is at least 768px wide (`DOCKED_MIN_WIDTH`) it docks to the top-left corner, beside the sidebar, at the top of one left column it shares with the legend; otherwise it docks to the bottom edge. This switch measures the map, not the window: with the sidebar open, windows from 1024px to 1279px leave a 576–767px map, so the bottom dock is part of the supported desktop layout. Padding is data, not map state: while docked and open it sets `mapInsetAtom` (`{ left: 400 }`), and every fit and flight goes through `useMapPadding()`, which adds the inset to `fitBounds` padding (or, for `flyTo`, an equivalent `offset`) and clamps it to the map's width. The map's own transform padding is never set, so opening the panel moves nothing; the one exception is a map click that the opening panel would cover, which the inspector nudges right by just enough (`coveredClickNudge`) to clear it.
- **Legend** (bottom left, under the docked inspector in the same column, so they never overlap): one row per loaded dataset (`MapRoleSymbol`, label, show/hide, "Fit map to {label}"), then the keys to the app's own map layers, passed as `OsmixMap`'s `legend` (a map key belongs here, not in the sidebar). Shown only while a dataset is loaded, and hidden while the bottom-docked inspector is open.

Esc closes the topmost open layer in this order: inspector (clearing the selection, or exiting routing in the route view), then route mode. Text fields and open menus, popovers (the search), sheets and dialogs handle Esc themselves. Selections and routing phases are read to a polite live region (`useMapAnnounce`). Only the basemap preset persists (`basemapPresetAtom`); selection, visibility, search and route state reset with the page. File info, download, save to storage and clear live in the sidebar (`OsmDatasetSection`), not on the map.

### Tasks and activity

Long work is recorded as **Tasks** with **Steps** in the `Tasks` store (`@osmix/app-core`). Start a task with `Tasks.run(title, fn, { controller })` (or `Tasks.start` when the outcome needs custom handling) and split it with `task.runStep` / `task.step`. Worker progress attaches to the innermost running step: `throttle` messages replace its live detail line, other messages become rows that keep their level.

- **One task at a time.** Starting a task while one runs throws `TaskAlreadyRunningError`. `OsmixAppShell` provides `TaskLockProvider`: `ActionButton` disables itself, and other task-starting controls read `useTaskLock()`. The map, inspection and the sidebar stay usable. There is no blocking modal.
- **Task toast.** Every top-level task gets one toast, id `task:<taskId>`, that changes in place. After 400ms of running (`PROGRESS_TOAST_DELAY_MS`) a progress toast appears: a spinner, "Task › step", a live timer, Cancel (only for tasks given an `AbortController`) and Details, which opens the Activity sheet. It has no close button and stays until the task ends. The timer is hidden from assistive tech, so the toast region announces step changes, not ticks. When the task ends the toast becomes its outcome (below). Work that finishes inside 400ms shows no progress toast.
- **Activity button.** The nav's last item opens the Activity sheet. It shows an error `StatusDot` until the newest failure is seen: the sheet opened, or that failure's toast dismissed (`acknowledgedErrorIdAtom`). The sheet never opens by itself.
- **Cancel.** Cancel is in the progress toast and on the running task's row in the Activity sheet. It aborts the controller and the task shows "Cancelling…". It keeps the lock until its work settles and it calls `task.cancelled()`.
- **Activity sheet.** The session's history (the last 200 top-level entries), newest first. Tasks and steps collapse and show their own duration: a live `m:ss` timer while running, the total when done. Messages show `+2.31s` from their task's start; the absolute time is in the hover title. Failures expand to the message, the stack and a copy button.
- **Toasts** are for top-level tasks only. They stack newest first, in a 384px column in the top-right corner of `MapContent`, a corner nothing else uses, and draw above the map's panels. On success the progress toast becomes a success toast that dismisses after 4s, or closes quietly for tasks under 1.5s (their summary still goes to a polite live region). Cancellation gets a short neutral toast. Errors, including top-level error messages, stay until dismissed and offer "View details"; a task that fails or is cancelled before its progress toast appeared still gets its outcome.
- **Copy.** Task and step titles are imperative ("Open monaco.pbf", "Hash file"); summaries are past tense ("monaco.pbf loaded").

Styling at call sites: outside `packages/ui`, `className` carries **layout** only. That covers:

- flex, grid, gap
- size, margin, padding
- position, `overflow-hidden`, alignment
- truncation, cursor

A few role classes are also allowed:

- `text-muted-foreground`, `text-foreground` and the status text colours
- `font-mono`, `font-semibold`, `font-medium`
- plain `border-*` sides
- the documented background opacities

If you need anything else, add a variant to the primitive.

## Copy

- Use sentence case everywhere: buttons, labels and titles.
- Use "…" (U+2026), never "...".
- Numbers in a column (counts, sizes, deltas) are right-aligned so they line up by place value: `TableCell numeric` and `TableHead numeric`. Key/value tables that mix text and numbers (File info) stay left-aligned. A list of labelled counts is a `Table`, not a `<dl>`.
- Empty states are one sentence with no trailing period.
- Errors say what failed and what to do next.
- Use one name per concept (for example "Open file"; see `apps/app/DESIGN.md` for the merge terms).
- **Export** writes a file the app generates (a PBF from the dataset in memory, an osmChange, a JSON report): "Export merged PBF", "Export {name} as PBF", "Export merge report (JSON)". Name the format when it is not obvious. **Download** is only for fetching from the network ("Download and open"). Tasks follow the same verbs ("Export x.pbf", "Exported x.pbf").

## Icons

- Use lucide only, imported by the `*Icon` name (`ChevronDownIcon`).
- `Button` sizes its icons, so don't add `size-*` inside a button. Standalone inline icons are `size-3.5`.
- Decorative icons get `aria-hidden="true"`.

## Tailwind sources

Tailwind v4 skips `node_modules`, so each package stylesheet declares `@source "./"`. Apps import the package stylesheets:

```css
@import "@osmix/ui/styles.css";
@import "@osmix/app-components/styles.css";
@source "./";
```

- Only `@osmix/ui/styles.css` may `@import "tailwindcss"`.
- CSS for DOM that MapLibre creates (`.maplibregl-ctrl`, `.osmix-overlay-popup`) goes in `packages/app-components/src/styles.css`.
- oxfmt sorts class lists (`sortTailwindcss` in `.oxfmtrc.json`).

## Enforcement map

The lint rules are set in `.oxlintrc.json`. `oxlint-tailwindcss` loads the design system from `packages/ui/src/styles.css`. The local rules live in `scripts/lint/osmix-design.ts`, with tests in `scripts/lint/osmix-design.test.ts` (`pnpm run test:design-lint`). Scope names the files each rule applies to: "all UI" is `apps/{merge,inspect,extract}/src`, `packages/app-components/src` and `packages/ui/src`; "apps" is `apps/{merge,inspect,extract}/src` and `packages/app-components/src`. The benchmark harness (`apps/bench`) is not a product UI and is out of scope.

| Rule                                                                                                                                                               | Enforced by                                                                        | Scope           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------- |
| Only theme tokens exist (no palette colours, stock shadows or font sizes)                                                                                          | Closed `@theme` + `tailwindcss/no-unknown-classes`                                 | all             |
| No colour literals (hex, `rgb()`, `oklch()`, named colours, MapLibre `["rgba", …]`)                                                                                | `osmix/no-raw-color`, `tailwindcss/no-hardcoded-colors`                            | all UI          |
| Layout-only call sites: no call-site size, case, tracking, bold, shadow, radius, `space-*`, ring/outline, `dark:`, or off-list background, text and border colours | `tailwindcss/no-restricted-classes`                                                | apps            |
| No arbitrary values (except `grid-cols-[…]`)                                                                                                                       | `tailwindcss/no-arbitrary-value`                                                   | apps            |
| No inline `style`                                                                                                                                                  | `react/forbid-dom-props`                                                           | apps            |
| `NativeSelect`, `Details` instead of native `<select>`, `<details>`, `<summary>`, `<textarea>`                                                                     | `react/forbid-elements`                                                            | apps            |
| `ScrollArea` instead of `overflow-auto` / `overflow-scroll`                                                                                                        | `tailwindcss/no-restricted-classes`                                                | apps            |
| `IconButton` instead of `<Button size="icon…">`                                                                                                                    | `osmix/no-icon-size-button`                                                        | apps            |
| `Radio` instead of `<input type="radio">`                                                                                                                          | `osmix/no-native-radio`                                                            | apps            |
| Lucide `*Icon` names                                                                                                                                               | `no-restricted-imports`                                                            | all UI          |
| "…" not "..." in UI copy                                                                                                                                           | `osmix/no-ascii-ellipsis`                                                          | all UI          |
| Desktop only: no `sm:`, `md:`, `lg:`, `max-*:` or `min-[…]:` variants ([Supported viewports](#supported-viewports))                                                | `osmix/no-breakpoint-variant`                                                      | all UI          |
| Canonical, non-conflicting, sorted classes                                                                                                                         | `tailwindcss/enforce-canonical`, `no-conflicting-classes`, oxfmt `sortTailwindcss` | all             |
| Which component to use (the table above)                                                                                                                           | Primitives + the rules above                                                       | partly advisory |
| Sentence case, empty-state and error copy                                                                                                                          | —                                                                                  | advisory        |
| Map roles match the legend (base = circle and solid, patch = diamond and dashed)                                                                                   | —                                                                                  | advisory        |

The map primitives in `packages/app-components` (`map-overlay.tsx`, `map-panel-header.tsx` and `app-links.tsx`) own their styling, so they are exempt from `no-restricted-classes`, like `packages/ui`. The toolbar, legend, inspector, search and routing files are not exempt: they get their look from `MapPanel`, `MapPanelHeader`, `IconButton`, `Alert` and `ScrollArea`.

When a rule has a real exception, disable it on that line and give the reason: `// oxlint-disable-next-line <rule> -- <why>`.

## Future work

- **Dark mode:** add a `.dark` token block and a toggle, and review the white map-mark exceptions.
- **Determinate progress:** extend `@osmix/shared` `Progress` with `percent?`, write it to the running step's `progress` field (already on `TaskNode`, not displayed yet), and pass a real `value` to `Progress`.
- **Screenshot baselines:** add Playwright visual baselines for each app's main states once the theme has settled.
