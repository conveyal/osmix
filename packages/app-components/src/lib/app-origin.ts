/** The Osmix browser apps, in nav order. */
export const OSMIX_APPS = [
  { id: "merge", label: "Merge", productionOrigin: "https://merge.osmix.dev" },
  { id: "inspect", label: "Inspect", productionOrigin: "https://inspect.osmix.dev" },
] as const;

export type OsmixAppId = (typeof OSMIX_APPS)[number]["id"];

const APP_IDS = new Set<string>(OSMIX_APPS.map((app) => app.id));

/**
 * Origin of a sibling app. Each app is served from `<app>.<domain>` (`merge.osmix.dev`,
 * `merge.osmix.localhost` under Portless, optionally behind a worktree prefix), so the sibling
 * is the same host with the app label swapped. Hosts that carry no app label, such as a bare
 * `localhost:5173`, fall back to the production origin.
 */
export function appOrigin(
  app: OsmixAppId,
  location: Pick<Location, "hostname" | "protocol" | "port"> = window.location,
): string {
  const labels = location.hostname.split(".");
  const index = labels.findIndex((label) => APP_IDS.has(label));
  if (index === -1) {
    const target = OSMIX_APPS.find((candidate) => candidate.id === app);
    if (!target) throw new Error(`Unknown Osmix app: ${app}`);
    return target.productionOrigin;
  }
  labels[index] = app;
  const port = location.port ? `:${location.port}` : "";
  return `${location.protocol}//${labels.join(".")}${port}`;
}
