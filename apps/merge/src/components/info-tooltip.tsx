import { Popover } from "@base-ui/react/popover";
import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils";

export function InfoTooltip({
  align = "center",
  children,
  className,
  defaultOpen = false,
  label,
  side = "top",
}: {
  align?: "center" | "end" | "start";
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  label: string;
  side?: "bottom" | "left" | "right" | "top";
}) {
  return (
    <Popover.Root defaultOpen={defaultOpen}>
      <Popover.Trigger
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        closeDelay={100}
        data-slot="info-tooltip-trigger"
        delay={200}
        openOnHover
      >
        <InfoIcon aria-hidden="true" className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align={align}
          className="z-100 max-w-[calc(100vw-1rem)]"
          side={side}
          sideOffset={6}
        >
          <Popover.Popup
            className="w-max max-w-72 rounded-md border bg-popover p-2 font-normal text-popover-foreground shadow-md transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0"
            data-slot="info-tooltip-content"
            initialFocus={false}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
