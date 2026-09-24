import { useLog } from "@osmix/app-core";
import { Details, DetailsContent, DetailsSummary, Spinner, StatusDot } from "@osmix/ui";

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
      <DetailsContent className="flex h-36 flex-col gap-1 overflow-auto bg-muted/50 p-2">
        <LogContent />
      </DetailsContent>
    </Details>
  );
}
