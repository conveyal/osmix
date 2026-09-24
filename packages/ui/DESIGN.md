# Osmix UI Design System

These are the conventions for `@osmix/ui`, `@osmix/app-components`, and every app built on them (`apps/merge`, `apps/inspect`, `apps/extract`). Read this before you make UI changes. Merge-specific rules are in `apps/merge/DESIGN.md`.

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

| Token                           | Use                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background`                    | The page (paper)                                                                                                                                        |
| `card`, `popover`               | Surfaces on the paper: cards, panels, menus                                                                                                             |
| `foreground`                    | Ink                                                                                                                                                     |
| `muted`, `muted-foreground`     | Sidebar background, secondary text                                                                                                                      |
| `accent`                        | Hover backgrounds                                                                                                                                       |
| `primary`, `primary-foreground` | Primary buttons (ink)                                                                                                                                   |
| `secondary`                     | Secondary buttons                                                                                                                                       |
| `border`, `input`               | Rules and field borders                                                                                                                                 |
| `brand` (survey orange)         | The brand mark, the focus ring, progress bars, step numbers and bbox marks. It is **never** a status colour                                             |
| `app` (`--app-hue`)             | The per-app hue: Merge violet, Inspect teal, Extract magenta. Used only for the nav brand mark and the active app link. `OsmixAppShell` sets `data-app` |
| `success`                       | Added, OK                                                                                                                                               |
| `warning`                       | Modified                                                                                                                                                |
| `info`                          | Selected, active, links                                                                                                                                 |
| `destructive`                   | Deleted, errors                                                                                                                                         |
| `overlay`                       | Dialog backdrop                                                                                                                                         |
| `white`, `black`                | Only for marks drawn on top of map imagery                                                                                                              |

Opacity steps:

| Step  | Use                                                    |
| ----- | ------------------------------------------------------ |
| `/5`  | Active selection (`bg-info/5`) and `Alert` backgrounds |
| `/10` | Diff-row backgrounds (`bg-success/10`)                 |
| `/40` | Tinted borders                                         |

### Map colors

MapLibre can't read CSS variables or `oklch()`. So layer paint gets its colours from `useMapColors()` in `@osmix/app-components`. That hook resolves the `--map-*` tokens to `rgb()` strings. Never write a colour literal in paint.

| Role                   | Token                               | Look                                                |
| ---------------------- | ----------------------------------- | --------------------------------------------------- |
| `base`                 | `--map-base` (ink)                  | The base or only dataset. Solid lines, circle nodes |
| `patch`                | `--map-patch` (brand)               | Imported / patch data. Dashed lines, diamond nodes  |
| `hover`                | `--map-hover`                       | The hovered feature                                 |
| `selected`             | `--map-selected` (info)             | The selected feature, drawn over a `casing`         |
| `casing`               | `--map-casing` (white)              | The outline under highlighted lines                 |
| `route` / `routeError` | `--map-route` / `--map-route-error` | Routes, and unreachable legs                        |
| `bbox`                 | `--map-bbox` (brand)                | The extract bounding box                            |

The default basemap is `carto-positron`. It's quiet, so data and status colours stand out.

### Type

| Role                                                          | Style                                        | Where it lives                                                           |
| ------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Body, UI copy                                                 | IBM Plex Sans, `text-xs`                     | `body`                                                                   |
| Data: IDs, tags, coordinates, file names, table cells, inputs | IBM Plex Mono                                | `TableCell`, `Input`, `MapPanelHeader` detail; `font-mono` at call sites |
| Section title                                                 | Plex Mono, bold, uppercase, `tracking-wider` | `SectionTitle`, `CardHeader`, `DetailsSummary`, `TableHead`              |
| Step and dialog title                                         | `text-sm font-semibold`, sentence case       | `Step`, `DialogTitle`                                                    |
| Emphasis                                                      | `font-semibold` or `font-medium`             | call sites                                                               |

Only two sizes exist: `text-xs` (the body default) and `text-sm` (set inside primitives). Write every string in sentence case. CSS uppercases section titles, and screen readers then read words instead of spelling out letters.

### Elevation, radius and focus

- **Flat:** a border and no shadow. Use it for cards, steps and items in the sidebar.
- **Raised (`shadow-raised`):** the nav and floating map panels (`CustomControl`).
- **Modal (`shadow-modal`):** dialogs, sheets, popovers and menus.
- **Radius:** `rounded-sm` to `rounded-xl` scale from `--radius`. Primitives choose it.
- **Focus:** the `focus-ring` utility (a 2px brand outline, and `CanvasText` in forced-colors mode). Every interactive primitive applies it. Never hand-write `ring-*` focus styles.

## Components

Primitives come from `@osmix/ui`. Map components come from `@osmix/app-components`.

| Need                                             | Use                                                                                                                               | Notes                                                                                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page layout                                      | `Main`, `AppSidebar` (`footer={<SidebarLog />}`), `MapContent`                                                                    | shadcn `Sidebar` below the nav: offcanvas collapse (nav trigger, edge rail, ⌘B), a sheet on mobile, open state persisted. It owns the scroll, the inset gutter and the `gap-2` rhythm |
| App root and nav                                 | `OsmixAppShell app="…"`                                                                                                           | Renders the sidebar provider, the tooltip provider and the standard nav (`OsmixNav`), and sets the app hue                                                                            |
| Workflow step                                    | `Step` (`number`, `title`, `action`)                                                                                              | Renders "1." in brand mono. Omit `number` for unnumbered steps                                                                                                                        |
| Sidebar section                                  | `Card` + `CardHeader` + `CardContent`                                                                                             | `CardContent` is `p-inset`; use `p-0` for flush tables and lists, and give flush children `px-inset`                                                                                  |
| Collapsible section                              | `Details`, `DetailsSummary`, `DetailsContent`                                                                                     | The chevron rotates on `data-panel-open`                                                                                                                                              |
| Heading inside a panel                           | `SectionTitle`                                                                                                                    | Never hand-write `font-bold uppercase`                                                                                                                                                |
| Callout (notice, warning, failure, confirmation) | `Alert` (`variant`, `title`, `action`)                                                                                            | `destructive` has `role="alert"`                                                                                                                                                      |
| Key/value data, diffs                            | `Table`                                                                                                                           | `TableCell` is mono and `select-all` on purpose                                                                                                                                       |
| Selectable rows                                  | `Item`, `ItemGroup`                                                                                                               | The `outline` variant has a real border                                                                                                                                               |
| Buttons                                          | `Button` (`default` = ink primary, `outline`, `secondary`, `ghost`, `destructive`, `link`)                                        | Default height `h-8` matches inputs and selects; `sm` (`h-7`) is for compact secondary actions. `buttonVariants()` styles a non-button trigger                                        |
| Async buttons                                    | `ActionButton`                                                                                                                    | Shows a spinner and a pending state. Icon-only: pass `label` + `icon`                                                                                                                 |
| Icon-only button                                 | `IconButton` (`label`, `icon`)                                                                                                    | `label` becomes the `aria-label` and a `Tooltip`; `render={<a …/>}` for icon links                                                                                                    |
| Short label on hover                             | `Tooltip`, `TooltipTrigger`, `TooltipContent`                                                                                     | `IconButton` uses it; `TooltipProvider` is mounted by `OsmixAppShell`                                                                                                                 |
| Text field                                       | `Input`, `InputGroup`                                                                                                             |                                                                                                                                                                                       |
| Action menu                                      | `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem`                                                                                  | The trigger takes `Button` variants                                                                                                                                                   |
| Dropdown                                         | `NativeSelect` + `NativeSelectOption`                                                                                             | A themed native `<select>`: native keyboard, typeahead and mobile pickers. `className` sets the wrapper width (`w-full` to fill)                                                      |
| Mutually exclusive options                       | `Radio` + `RadioLabel` or `RadioCard`, in a `<fieldset>`                                                                          | A themed native radio: arrow keys and focus stay native                                                                                                                               |
| Checkbox                                         | `Checkbox` + `CheckboxLabel`                                                                                                      |                                                                                                                                                                                       |
| Pagination                                       | `Pager` (`page` is zero-based)                                                                                                    | Renders nothing for a single page                                                                                                                                                     |
| Optional explanation                             | `InfoTooltip`                                                                                                                     | Keep essential labels visible                                                                                                                                                         |
| Nothing to show                                  | `EmptyState`                                                                                                                      | One sentence, no trailing period                                                                                                                                                      |
| Waiting                                          | `Spinner` (inline), `LoadingState` (a section or Suspense), `Progress` (long worker tasks, with `value={null}` for indeterminate) | Never text alone                                                                                                                                                                      |
| Status                                           | `StatusDot` (`ok`, `warn`, `error`)                                                                                               |                                                                                                                                                                                       |
| Dialog                                           | `Dialog`, `DialogContent`, `DialogTitle`, …                                                                                       |                                                                                                                                                                                       |
| Floating map panel                               | `CustomControl` (`width="narrow"` or `"default"`) + `MapPanelHeader` (`icon`, `title`, `detail`, `actions`)                       |                                                                                                                                                                                       |
| Map paint colours                                | `useMapColors()`                                                                                                                  | See [Map colors](#map-colors)                                                                                                                                                         |

### Spacing and sizing

- **Inset (`--spacing-inset`, 12px):** the padding from every edge-aligned surface to its content: `CardHeader`, `CardContent`, `Step` header, `DetailsSummary`, table first and last cells, `EmptyState`, `LoadingState`, `Alert`, `MapPanelHeader` and sidebar groups. Children of flush content use `p-inset` or `px-inset`, so text lines up with the header above it.
- **Rhythm:** `gap-2` between items inside a surface.
- **Control height:** `h-8` for buttons, inputs and selects, so mixed rows line up.
- **Lists in prose:** `list-decimal pl-4` or `list-disc pl-4` (markers outside), never `list-inside`.

### Nav

The nav is `--header-height` (2.5rem) tall with a `gap-3` rhythm. Left: the sidebar trigger, the brand, a `NavSeparator` and the app links (the current app is underlined on the nav's bottom edge in its hue). Centre: status. Right: map controls, a `NavSeparator`, "Check system" and the GitHub link.

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
- Empty states are one sentence with no trailing period.
- Errors say what failed and what to do next.
- Use one name per concept (for example "Open file"; see `apps/merge/DESIGN.md` for the merge terms).

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
- CSS for DOM that MapLibre creates (`.maplibregl-ctrl`, `.osmix-overlay-popup`, `.osmix-map-panel`) goes in `packages/app-components/src/styles.css`.
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
| Canonical, non-conflicting, sorted classes                                                                                                                         | `tailwindcss/enforce-canonical`, `no-conflicting-classes`, oxfmt `sortTailwindcss` | all             |
| Which component to use (the table above)                                                                                                                           | Primitives + the rules above                                                       | partly advisory |
| Sentence case, empty-state and error copy                                                                                                                          | —                                                                                  | advisory        |
| Map roles match the legend (base = circle and solid, patch = diamond and dashed)                                                                                   | —                                                                                  | advisory        |

The map primitives in `packages/app-components` (`custom-control.tsx`, `map-panel-header.tsx` and `app-links.tsx`) own their styling, so they are exempt from `no-restricted-classes`, like `packages/ui`.

When a rule has a real exception, disable it on that line and give the reason: `// oxlint-disable-next-line <rule> -- <why>`.

## Future work

- **Dark mode:** add a `.dark` token block and a toggle, and review the white map-mark exceptions.
- **Determinate progress:** extend `@osmix/shared` `Progress` with `percent?` and pass a real `value` to `Progress`.
- **Screenshot baselines:** add Playwright visual baselines for each app's main states once the theme has settled.
