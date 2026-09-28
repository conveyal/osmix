import type { ComponentProps } from "react";

import { SidebarSection } from "./sidebar-section.tsx";

/**
 * A numbered workflow step: the sidebar section that opens each stage of a multi-step flow
 * (Merge's wizard, Extract's form). Numbers render as "1." in the brand color before the title;
 * omit `number` for an unnumbered step such as Merge's automatic workflow. Content goes straight
 * in `children`, padded like any `SidebarSection`.
 */
export function Step(props: ComponentProps<typeof SidebarSection>) {
  return <SidebarSection {...props} />;
}
