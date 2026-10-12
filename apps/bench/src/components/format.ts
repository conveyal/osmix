export function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms).toLocaleString()} ms`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

/** "Osmix 3.2× faster", from two medians. */
export function formatRatio(osmixMs: number, duckdbMs: number): string {
  const osmixFaster = osmixMs <= duckdbMs;
  const ratio = osmixFaster ? duckdbMs / osmixMs : osmixMs / duckdbMs;
  if (ratio < 1.1) return "About the same";
  return `${osmixFaster ? "Osmix" : "DuckDB"} ${ratio.toFixed(1)}× faster`;
}
