export function ensureOsmPbfDownloadName(filename: string): string {
  if (filename.toLowerCase().endsWith(".pbf")) return filename;

  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return `${filename}.pbf`;

  return `${filename.slice(0, lastDot)}.pbf`;
}

/**
 * Replace the file extension with `-<suffix>.pbf`, so `monaco.osm.pbf` with `deduplicated`
 * becomes `monaco-deduplicated.pbf`. A name that already ends with the suffix keeps one copy.
 */
export function suffixOsmPbfName(filename: string, suffix: string): string {
  const stem = filename.replace(/(\.osm)?\.[^.]+$/i, "") || "dataset";
  return stem.endsWith(`-${suffix}`) ? `${stem}.pbf` : `${stem}-${suffix}.pbf`;
}
