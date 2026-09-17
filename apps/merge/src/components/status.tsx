import { formatTimestampMs, StatusDot, Spinner } from "@osmix/ui";

import { useLog } from "../hooks/log";

export default function Status() {
  const { log, activeTasks } = useLog();
  const status = log[log.length - 1];
  if (!status) return null;
  return (
    <div
      className="flex flex-row items-center gap-2 overflow-hidden px-4"
      title={formatTimestampMs(status.timestamp)}
    >
      {activeTasks > 0 ? (
        <Spinner />
      ) : (
        <StatusDot status={status.type === "error" ? "error" : "ok"} />
      )}
      <div className="shrink overflow-hidden text-ellipsis whitespace-nowrap text-foreground">
        {status.message}
      </div>
    </div>
  );
}
