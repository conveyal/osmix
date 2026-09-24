import { useLog } from "@osmix/app-core";
import { Details, DetailsContent, DetailsSummary, ScrollArea, Spinner, StatusDot } from "@osmix/ui";

import LogContent from "./log.tsx";

/** The collapsible activity log at the foot of the sidebar, with the latest status. */
export default function SidebarLog() {
  const { activeTasks, log } = useLog();
  const status = log[log.length - 1];
  return (
    <Details defaultOpen={false}>
      <DetailsSummary>
        Activity log
        {activeTasks > 0 ? (
          <Spinner />
        ) : (
          <StatusDot status={status?.type === "error" ? "error" : "ok"} />
        )}
      </DetailsSummary>
      <DetailsContent className="bg-muted/50">
        <ScrollArea className="h-36" orientation="both">
          <div className="flex flex-col gap-1 px-inset py-2">
            <LogContent />
          </div>
        </ScrollArea>
      </DetailsContent>
    </Details>
  );
}
