import { Popover as BasePopover } from "@base-ui/react/popover";
import type * as React from "react";

import { cn } from "../../lib/utils.ts";
import { buttonVariants } from "./button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

/**
 * A non-modal floating panel anchored to its trigger, for tools that need more than a menu (the
 * map search). Compose `Popover` > `PopoverIconTrigger` + `PopoverContent`. It owns Esc, outside
 * clicks and focus return.
 */
function Popover(props: React.ComponentProps<typeof BasePopover.Root>) {
  return <BasePopover.Root {...props} />;
}

/**
 * An icon-only popover trigger: a ghost icon button whose `label` becomes its `aria-label` and a
 * tooltip, like `IconButton` and `MenuIconTrigger`.
 */
function PopoverIconTrigger({
  label,
  icon,
  className,
  size = "icon-sm",
  tooltipSide = "bottom",
  ...props
}: Omit<React.ComponentProps<typeof BasePopover.Trigger>, "children"> & {
  /** Accessible name and tooltip text. Required: an icon alone has no name. */
  label: string;
  icon: React.ReactNode;
  size?: "icon" | "icon-sm" | "icon-xs" | "icon-lg";
  tooltipSide?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <BasePopover.Trigger
            data-slot="popover-trigger"
            className={cn(buttonVariants({ variant: "ghost", size }), className)}
            aria-label={label}
            {...props}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The floating panel: a modal-elevation card under its trigger. `align` lines it up with the
 * trigger's start or end; `finalFocus` overrides where focus goes on close (default: the
 * trigger). `className` is for layout (width).
 */
function PopoverContent({
  align = "center",
  className,
  finalFocus,
  children,
  ...props
}: Omit<React.ComponentProps<typeof BasePopover.Popup>, "className"> & {
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner className="z-50" sideOffset={6} align={align}>
        <BasePopover.Popup
          data-slot="popover-content"
          finalFocus={finalFocus}
          className={cn(
            "flex flex-col rounded-md border bg-popover text-popover-foreground shadow-modal outline-none",
            className,
          )}
          {...props}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}

export { Popover, PopoverContent, PopoverIconTrigger };
