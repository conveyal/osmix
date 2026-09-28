/**
 * Display names for loaded datasets. The worker and the library name a dataset by its ID (the
 * file's SHA-256 in the apps), so their progress and error text carries that ID; the Activity
 * log swaps each known ID for the file name. A name is recorded whenever a dataset's file info
 * is set, before the load or merge that reports on it runs.
 */
const names = new Map<string, string>();

/** Record `name` as the display name of the dataset with `id`. */
export function nameDataset(id: string, name: string) {
  if (id === "" || name === "") return;
  names.set(id, name);
}

/** `text` with every known dataset ID replaced by that dataset's name. */
export function withDatasetNames(text: string): string {
  let named = text;
  for (const [id, name] of names) {
    if (named.includes(id)) named = named.replaceAll(id, name);
  }
  return named;
}

/** Forget every name. Tests only. */
export function clearDatasetNames() {
  names.clear();
}
