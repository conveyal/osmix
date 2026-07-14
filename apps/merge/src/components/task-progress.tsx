import { useEffect, useState } from "react";

import { useLog } from "../hooks/log";
import { Progress } from "./ui/progress";

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Progress feedback for long-running worker tasks. Worker progress messages do
 * not include a numeric percentage yet, so the bar is indeterminate; the latest
 * log message and a live elapsed timer show that work is advancing.
 */
export default function TaskProgress() {
  const { log, activeTasks, taskStartedAt } = useLog();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (taskStartedAt == null) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [taskStartedAt]);

  if (activeTasks === 0 || taskStartedAt == null) return null;
  const latest = log[log.length - 1];

  return (
    <div className="flex flex-col gap-2">
      <Progress value={null} />
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <div className="overflow-hidden text-ellipsis whitespace-nowrap">{latest?.message}</div>
        <div className="shrink-0 tabular-nums">
          {formatElapsed(Math.max(0, now - taskStartedAt))}
        </div>
      </div>
    </div>
  );
}
