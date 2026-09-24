import { appOrigin, OSMIX_APPS, type OsmixAppId } from "../lib/app-origin.ts";

/**
 * Links to every Osmix app for the `Nav` shell's `links` slot. The current app is marked with
 * the per-app hue and is not a link; the others resolve to their sibling origin (`appOrigin`).
 */
export function AppLinks({ current }: { current: OsmixAppId }) {
  return (
    <div className="flex items-center gap-3">
      {OSMIX_APPS.map((app) =>
        app.id === current ? (
          <span
            key={app.id}
            className="border-b-2 border-app py-0.5 font-semibold text-foreground"
            aria-current="page"
          >
            {app.label}
          </span>
        ) : (
          <a
            key={app.id}
            href={appOrigin(app.id)}
            data-slot="app-link"
            className="border-b-2 border-transparent py-0.5 text-muted-foreground focus-ring hover:text-foreground"
          >
            {app.label}
          </a>
        ),
      )}
    </div>
  );
}
