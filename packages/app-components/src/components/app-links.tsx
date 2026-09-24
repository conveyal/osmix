import { appOrigin, OSMIX_APPS, type OsmixAppId } from "../lib/app-origin.ts";

/**
 * Links to every Osmix app for the `Nav` shell's `links` slot. The current app is marked with
 * the per-app hue and is not a link; the others resolve to their sibling origin (`appOrigin`).
 */
export function AppLinks({ current }: { current: OsmixAppId }) {
  return (
    <div className="flex h-full items-stretch gap-4">
      {OSMIX_APPS.map((app) =>
        app.id === current ? (
          <span
            key={app.id}
            className="flex items-center border-y-2 border-t-transparent border-b-app font-semibold text-foreground"
            aria-current="page"
          >
            {app.label}
          </span>
        ) : (
          <a
            key={app.id}
            href={appOrigin(app.id)}
            data-slot="app-link"
            className="flex items-center border-y-2 border-transparent text-muted-foreground focus-ring hover:text-foreground"
          >
            {app.label}
          </a>
        ),
      )}
    </div>
  );
}
