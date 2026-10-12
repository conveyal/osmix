import { Link } from "wouter";

import { OSMIX_PAGES, type OsmixRoute } from "../lib/app-pages.ts";

/**
 * Links to the app's pages for the `Nav` shell's `links` slot. The current page is marked with
 * its hue and is not a link. Navigating keeps every page's state and the shared map.
 */
export function AppLinks({ current }: { current: OsmixRoute | null }) {
  return (
    <div className="flex h-full items-stretch gap-4">
      {OSMIX_PAGES.map((page) =>
        page.id === current ? (
          <span
            key={page.id}
            className="flex items-center border-y-2 border-t-transparent border-b-app font-semibold text-foreground"
            aria-current="page"
          >
            {page.label}
          </span>
        ) : (
          <Link
            key={page.id}
            href={page.path}
            data-slot="app-link"
            className="flex items-center border-y-2 border-transparent text-muted-foreground focus-ring hover:text-foreground"
          >
            {page.label}
          </Link>
        ),
      )}
    </div>
  );
}
