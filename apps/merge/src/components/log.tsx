import { useLog } from "../hooks/log";
import { cn } from "../lib/utils";
import { formatTimestampMs } from "../utils";

export default function LogContent() {
  const { log } = useLog();
  return (
    <>
      {log.toReversed().map((message, index) => (
        <div
          key={`${message.timestamp}-${message.message}`}
          className={cn(
            "whitespace-nowrap",
            "text-muted-foreground",
            index === 0 && "text-foreground font-medium",
          )}
          title={formatTimestampMs(message.timestamp)}
        >
          [{(message.duration / 1_000).toFixed(3)}s] {message.message}
        </div>
      ))}
    </>
  );
}
