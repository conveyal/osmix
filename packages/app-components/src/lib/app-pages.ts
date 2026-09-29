/** The pages of the Osmix app, in nav order. Home (`/`) introduces them. */
export const OSMIX_PAGES = [
  { id: "merge", label: "Merge", path: "/merge" },
  { id: "inspect", label: "Inspect", path: "/inspect" },
  { id: "extract", label: "Extract", path: "/extract" },
] as const;

export type OsmixPageId = (typeof OSMIX_PAGES)[number]["id"];

/** Routes that cover the sidebar and map with a `FullPage`: Home and Limits. */
type OsmixFullPageRoute = "home" | "limits";

/** A page, or a full page (Home or Limits). */
export type OsmixRoute = OsmixPageId | OsmixFullPageRoute;

export const HOME_PATH = "/";

/** What Osmix can load, for app users; linked from Home and Check System. */
export const LIMITS_PATH = "/limits";

/** Whether a route is a full page (no sidebar, map idle) rather than a map page. */
export function isFullPageRoute(route: OsmixRoute): route is OsmixFullPageRoute {
  return route === "home" || route === "limits";
}

/** The path of a page. */
export function pagePath(id: OsmixPageId): string {
  const page = OSMIX_PAGES.find((candidate) => candidate.id === id);
  if (!page) throw Error(`Unknown Osmix page: ${id}`);
  return page.path;
}

/**
 * What a location path shows: a page, `home` for `/`, `limits` for `/limits`, or null for any
 * other path. A trailing
 * slash is ignored; paths below a page (`/merge/x`) are not pages.
 */
export function routeForPath(path: string): OsmixRoute | null {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (normalized === HOME_PATH || normalized === "") return "home";
  if (normalized === LIMITS_PATH) return "limits";
  return OSMIX_PAGES.find((page) => page.path === normalized)?.id ?? null;
}
