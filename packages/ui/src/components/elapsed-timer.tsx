import { useEffect, useState } from "react";

import { formatDuration, formatElapsedClock } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";

/**
 * Time since `startedAt`. While `endedAt` is unset it ticks once a second as a clock ("1:04");
 * once set it shows the final duration ("2.31s"). Mount it per run (key it by task) so the
 * clock starts from the run's own start.
 */
export function ElapsedTimer({
  className,
  endedAt,
  startedAt,
}: {
  className?: string;
  endedAt?: number | undefined;
  startedAt: number;
}) {
  const running = endedAt === undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [running]);
  const text = running ? formatElapsedClock(now - startedAt) : formatDuration(endedAt - startedAt);
  return (
    <span
      data-slot="elapsed-timer"
      data-running={running || undefined}
      className={cn("font-mono whitespace-nowrap tabular-nums", className)}
    >
      {text}
    </span>
  );
}
