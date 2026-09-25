import type * as React from "react";

import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.tsx";

type IconButtonProps = Omit<React.ComponentProps<typeof Button>, "children" | "size"> & {
  /** Accessible name and tooltip text. Required: an icon alone has no name. */
  label: string;
  icon: React.ReactNode;
  size?: "icon" | "icon-sm" | "icon-xs" | "icon-lg";
  tooltipSide?: "top" | "bottom" | "left" | "right";
};

/**
 * The only icon-only button: a ghost `Button` whose `label` becomes its `aria-label` and a
 * tooltip. Pass `render={<a href="…" />}` for an icon link. A toggle (`aria-pressed`) shows
 * its on state in `info`, so every pressed toggle looks the same.
 */
export function IconButton({
  label,
  icon,
  className,
  variant = "ghost",
  size = "icon-sm",
  tooltipSide = "bottom",
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
            size={size}
            aria-label={label}
            className={cn("aria-pressed:text-info", className)}
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
