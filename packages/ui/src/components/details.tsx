import type { ClassValue } from "clsx";
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils.ts";
import { SectionTitle } from "./section.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";

export function Details({
  className,
  children,
  defaultOpen = true,
}: {
  className?: ClassValue;
  children?: ReactNode;
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
        "group flex h-8 w-full cursor-pointer items-center justify-between border-t p-2 focus-ring transition-colors hover:bg-accent data-panel-open:border-b",
        className,
      )}
    >
      <SectionTitle>{children}</SectionTitle>
      <ChevronDownIcon
        aria-hidden="true"
        className="size-4 transition-transform group-data-panel-open:rotate-180"
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
