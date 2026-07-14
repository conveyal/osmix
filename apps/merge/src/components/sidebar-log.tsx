import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { useLog } from "../hooks/log";
import { cn } from "../lib/utils";
import LogContent from "./log";
import { SectionTitle } from "./section";
import { StatusDot } from "./status-dot";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Spinner } from "./ui/spinner";

export default function SidebarLog() {
  const { activeTasks, log } = useLog();
  const status = log[log.length - 1];
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="relative z-10 flex h-8 w-full cursor-pointer items-center justify-between border-t bg-background p-2 shadow hover:bg-accent">
        <SectionTitle>Activity log</SectionTitle>

        <div className="flex items-center gap-4">
          {activeTasks > 0 ? (
            <Spinner />
          ) : (
            <StatusDot status={status.type === "error" ? "error" : "ok"} />
          )}
          <ChevronDown className={cn("size-4 transition-all", open && "rotate-180")} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn(
          "flex h-0 flex-col gap-1 overflow-x-auto overflow-y-auto bg-muted/50 px-2 pb-4 transition-all",
          open && "h-36 pt-2",
        )}
      >
        <LogContent />
      </CollapsibleContent>
    </Collapsible>
  );
}
