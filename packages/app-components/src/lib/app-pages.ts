/** The pages of the Osmix app, in nav order. Home (`/`) introduces them. */
export const OSMIX_PAGES = [
  { id: "merge", label: "Merge", path: "/merge" },
  { id: "inspect", label: "Inspect", path: "/inspect" },
  { id: "extract", label: "Extract", path: "/extract" },
] as const;

export type OsmixPageId = (typeof OSMIX_PAGES)[number]["id"];

/** A page, or Home. */
export type OsmixRoute = OsmixPageId | "home";

export const HOME_PATH = "/";

/** The path of a page. */
export function pagePath(id: OsmixPageId): string {
  const page = OSMIX_PAGES.find((candidate) => candidate.id === id);
  if (!page) throw Error(`Unknown Osmix page: ${id}`);
  return page.path;
}

/**
 * What a location path shows: a page, `home` for `/`, or null for any other path. A trailing
 * slash is ignored; paths below a page (`/merge/x`) are not pages.
 */
export function routeForPath(path: string): OsmixRoute | null {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (normalized === HOME_PATH || normalized === "") return "home";
  return OSMIX_PAGES.find((page) => page.path === normalized)?.id ?? null;
}
