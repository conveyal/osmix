import { type ActivityEntry, type TaskNode, Tasks, useTasks } from "@osmix/app-core";
import {
  ActivityError,
  ActivityItem,
  ActivityMessage,
  ElapsedTimer,
  EmptyState,
  formatDuration,
  formatTimestampMs,
  IconButton,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@osmix/ui";
import { useAtom, useSetAtom } from "jotai";
import { XIcon } from "lucide-react";
import { useEffect } from "react";

import {
  acknowledgedErrorIdAtom,
  activitySheetOpenAtom,
  latestErrorId,
} from "../state/activity.ts";

/**
 * The session's activity history: tasks and their steps as a collapsible tree, newest first. A
 * running task that allows it has Cancel. While open, every failure in it counts as seen.
 */
export function ActivitySheet() {
  const [open, setOpen] = useAtom(activitySheetOpenAtom);
  const setAcknowledged = useSetAtom(acknowledgedErrorIdAtom);
  const { entries } = useTasks();
  useEffect(() => {
    if (open) setAcknowledged(latestErrorId(entries));
  }, [open, entries, setAcknowledged]);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="gap-0 data-[side=right]:w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Activity</SheetTitle>
          <SheetDescription>Tasks from this session, newest first</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          {entries.length === 0 ? (
            <EmptyState>No activity yet</EmptyState>
          ) : (
            <ol aria-label="Activity history" className="flex flex-col gap-1 p-inset">
              {entries.toReversed().map((entry) => (
                <li key={entry.id}>
                  <ActivityEntryView entry={entry} rootStartedAt={null} />
                </li>
              ))}
            </ol>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function ActivityEntryView({
  entry,
  rootStartedAt,
}: {
  entry: ActivityEntry;
  /** The top-level task's start, for message offsets. `null` at the top level. */
  rootStartedAt: number | null;
}) {
  if (entry.kind === "message") {
    return (
      <ActivityMessage
        level={entry.level}
        message={entry.message}
        meta={
          rootStartedAt === null
            ? formatTimestampMs(entry.at).slice(0, 8)
            : `+${formatDuration(entry.at - rootStartedAt)}`
        }
        titleAttribute={formatTimestampMs(entry.at)}
      />
    );
  }
  return <TaskNodeView node={entry} rootStartedAt={rootStartedAt ?? entry.startedAt} />;
}

function TaskNodeView({ node, rootStartedAt }: { node: TaskNode; rootStartedAt: number }) {
  const open = node.status === "running" || node.status === "cancelling";
  const cancelling = node.status === "cancelling";
  const showSummary = node.summary !== undefined && node.summary !== node.title;
  const hasBody = node.children.length > 0 || showSummary || node.error !== undefined;
  const finishedAt = node.endedAt ? ` · finished ${formatTimestampMs(node.endedAt)}` : "";
  return (
    <ActivityItem
      status={node.status}
      title={node.title}
      topLevel={node.kind === "task"}
      detail={open ? node.detail : undefined}
      defaultOpen={open || node.status === "error"}
      titleAttribute={`Started ${formatTimestampMs(node.startedAt)}${finishedAt}`}
      meta={<ElapsedTimer startedAt={node.startedAt} endedAt={node.endedAt} />}
      actions={
        node.kind === "task" && open && node.cancellable ? (
          <IconButton
            size="icon-xs"
            label={cancelling ? "Cancelling…" : `Cancel ${node.title}`}
            icon={<XIcon aria-hidden="true" />}
            disabled={cancelling}
            onClick={() => Tasks.cancel(node.id)}
          />
        ) : undefined
      }
    >
      {hasBody ? (
        <>
          {node.children.map((child) => (
            <ActivityEntryView key={child.id} entry={child} rootStartedAt={rootStartedAt} />
          ))}
          {showSummary && node.summary ? (
            <ActivityMessage
              level={node.status === "error" ? "error" : "info"}
              message={node.summary}
              meta={node.endedAt ? `+${formatDuration(node.endedAt - rootStartedAt)}` : undefined}
            />
          ) : null}
          {node.error ? (
            <ActivityError message={node.error.message} stack={node.error.stack} />
          ) : null}
        </>
      ) : undefined}
    </ActivityItem>
  );
}
