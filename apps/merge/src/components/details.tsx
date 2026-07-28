import type { ClassValue } from "clsx";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { SectionTitle } from "./section";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

export function Details({
  className,
  children,
  defaultOpen = true,
}: {
  className?: ClassValue;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("w-full", className)}>
      {children}
    </Collapsible>
  );
}

export function DetailsSummary({
  className,
  children,
}: {
  className?: ClassValue;
  children: ReactNode;
}) {
  return (
    <CollapsibleTrigger
      className={cn(
        "group border-t w-full flex justify-between items-center p-2 cursor-pointer hover:bg-accent transition-colors h-8 data-panel-open:shadow-sm",
        className,
      )}
    >
      <SectionTitle>{children}</SectionTitle>
      <ChevronDown
        aria-hidden="true"
        className="size-4 group-data-panel-open:rotate-180 transition-transform"
      />
    </CollapsibleTrigger>
  );
}

export function DetailsContent({
  className,
  children,
}: {
  className?: ClassValue;
  children: ReactNode;
}) {
  return <CollapsibleContent className={cn("", className)}>{children}</CollapsibleContent>;
}
