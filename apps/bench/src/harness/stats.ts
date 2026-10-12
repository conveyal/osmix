/** Summary statistics for a set of timings, in milliseconds. */
export interface TimingStats {
  median: number;
  p95: number;
  min: number;
  runs: number;
}

/** Linear-interpolated percentile, `p` in [0, 1]. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw Error("percentile() needs at least one sample");
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] as number;
  const high = sorted[upper] as number;
  return low + (high - low) * (position - lower);
}

export function summarize(samples: number[]): TimingStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    min: sorted[0] as number,
    runs: sorted.length,
  };
}
