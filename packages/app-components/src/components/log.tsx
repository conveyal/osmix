import { useLog } from "@osmix/app-core";
import { cn, formatTimestampMs } from "@osmix/ui";

export default function LogContent() {
  const { log } = useLog();
  return (
    <>
      {log.toReversed().map((message, index) => (
        <div
          key={`${message.timestamp}-${message.message}`}
          className={cn(
            "font-mono whitespace-nowrap",
            index === 0 ? "font-medium" : "text-muted-foreground",
          )}
          title={formatTimestampMs(message.timestamp)}
        >
          [{(message.duration / 1_000).toFixed(3)}s] {message.message}
        </div>
      ))}
    </>
  );
}
