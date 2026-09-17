import { cn } from "@osmix/ui";

import { appOrigin, OSMIX_APPS, type OsmixAppId } from "../lib/app-origin.ts";

/**
 * Links to every Osmix app for the `Nav` shell's `links` slot. The current app is highlighted
 * and not a link; the others resolve to their sibling origin (see `appOrigin`).
 */
export function AppLinks({ current }: { current: OsmixAppId }) {
  return (
    <>
      {OSMIX_APPS.map((app) =>
        app.id === current ? (
          <span key={app.id} className="font-normal text-info" aria-current="page">
            {app.label}
          </span>
        ) : (
          <a
            key={app.id}
            href={appOrigin(app.id)}
            className={cn("font-normal text-muted-foreground hover:underline")}
          >
            {app.label}
          </a>
        ),
      )}
    </>
  );
}
