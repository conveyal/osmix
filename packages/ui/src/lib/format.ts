export function flattenValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return value.toLocaleString();
  }
  if (typeof value === "boolean") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((v) => flattenValue(v)).join(",");
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value)
      .map(([key, value]) => {
        return `${key}=${flattenValue(value)}`;
      })
      .join(",");
  }
  return "";
}

const formatMmSsMs = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hour12: false,
});

/**
 * Format a timestamp as "HH:MM:SS.sss"
 */
export function formatTimestampMs(timestamp: number) {
  return formatMmSsMs.format(new Date(timestamp));
}

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

export function bytesSizeToHuman(size?: number) {
  if (size == null) return "none";
  if (size < KB) return `${size}B`;
  if (size < MB) return `${(size / KB).toFixed(2)}KB`;
  if (size < GB) return `${(size / MB).toFixed(2)}MB`;
  return `${(size / GB).toFixed(2)}GB`;
}

/** Format elapsed milliseconds as a clock: "0:07", "12:34", "1:02:03". */
export function formatElapsedClock(ms: number) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
  return `${minutes}:${seconds}`;
}

/** Format a finished duration: "812ms", "2.31s", then clock form from one minute. */
export function formatDuration(ms: number) {
  const clamped = Math.max(0, Math.round(ms));
  if (clamped < 1_000) return `${clamped}ms`;
  if (clamped < 60_000) return `${(clamped / 1_000).toFixed(2)}s`;
  return formatElapsedClock(clamped);
}
