import type { ReactNode } from "react";
import { useId } from "react";

import { cn } from "../lib/utils.ts";
import { ScrollArea } from "./ui/scroll-area.tsx";

/**
 * A page without the map, such as the app's Home. It covers the sidebar and map row below the
 * nav, so both stay mounted underneath it, on the paper background, and scrolls in one
 * `ScrollArea`. Content sits in one readable column: the `title` and `lead`, then `children`
 * (`FeatureSection`s and `FullPageSection`s, divided flat like sidebar sections), then the
 * `footer`.
 */
export function FullPage({
  children,
  footer,
  lead,
  title,
}: {
  children: ReactNode;
  footer?: ReactNode;
  lead: ReactNode;
  title: ReactNode;
}) {
  const titleId = useId();
  return (
    <main
      data-slot="full-page"
      aria-labelledby={titleId}
      className="absolute inset-0 z-20 bg-background"
    >
      <ScrollArea className="h-full">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-inset py-12">
          <header className="flex flex-col gap-2">
            <h1
              id={titleId}
              className="flex items-center gap-2 font-mono text-sm font-bold tracking-widest uppercase"
            >
              <span aria-hidden="true" className="brand-mark" />
              {title}
            </h1>
            <p className="text-muted-foreground">{lead}</p>
          </header>
          <div className="flex flex-col divide-y border-y">{children}</div>
          {footer ? <footer className="text-muted-foreground">{footer}</footer> : null}
        </div>
      </ScrollArea>
    </main>
  );
}

/**
 * One section of a `FullPage`: a title with an optional `action`, then free `children` (text,
 * `BulletList`, `Table`, `Alert`), spaced like a sidebar section. Flat: the page divides the
 * sections.
 */
export function FullPageSection({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      data-slot="full-page-section"
      aria-labelledby={titleId}
      className="flex flex-col gap-2 py-6"
    >
      <div className="flex items-center gap-4">
        <h2
          id={titleId}
          className="min-w-0 flex-1 font-mono text-sm font-bold tracking-wider uppercase"
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A plain bullet list for a `FullPage`, muted like `FeatureSection`'s list unless `emphasis`. */
export function BulletList({
  emphasis = false,
  items,
}: {
  emphasis?: boolean;
  items: readonly ReactNode[];
}) {
  return (
    <ul
      data-slot="bullet-list"
      className={cn("flex list-disc flex-col gap-1 pl-4", !emphasis && "text-muted-foreground")}
    >
      {items.map((item, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- a static list that never reorders
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * One feature of a `FullPage`: a `FullPageSection` with its `action` (a link to the feature), a
 * short description, what it does as a bullet list, and an optional `status` line (what is open
 * there now).
 */
export function FeatureSection({
  action,
  children,
  features,
  status,
  title,
}: {
  action: ReactNode;
  children: ReactNode;
  features: readonly ReactNode[];
  status?: ReactNode;
  title: ReactNode;
}) {
  return (
    <FullPageSection title={title} action={action}>
      <p>{children}</p>
      <BulletList items={features} />
      {status ? <p data-slot="feature-section-status">{status}</p> : null}
    </FullPageSection>
  );
}
