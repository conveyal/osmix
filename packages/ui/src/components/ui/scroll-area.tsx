import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import type * as React from "react";

import { cn } from "../../lib/utils.ts";

type ScrollOrientation = "vertical" | "horizontal" | "both";

/**
 * The only scroll container: themed, overlay scrollbars on every platform. Bound its size from
 * outside — a height (`h-36`), a max height (`max-h-48`), or `flex-1` inside a flex column — the
 * root is a flex column, so a max height alone is enough. `orientation` picks the scrollbars;
 * horizontal content is measured at its natural width (wide tables, `pre`).
 */
function ScrollArea({
  className,
  children,
  orientation = "vertical",
  viewportRef,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  orientation?: ScrollOrientation;
  viewportRef?: React.Ref<HTMLDivElement>;
}) {
  const horizontal = orientation !== "vertical";
  const vertical = orientation !== "horizontal";
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative flex min-h-0 min-w-0 flex-col overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className="min-h-0 w-full flex-1 rounded-[inherit] focus-ring"
      >
        {horizontal ? (
          <ScrollAreaPrimitive.Content data-slot="scroll-area-content">
            {children}
          </ScrollAreaPrimitive.Content>
        ) : (
          children
        )}
      </ScrollAreaPrimitive.Viewport>
      {vertical ? <ScrollBar orientation="vertical" /> : null}
      {horizontal ? <ScrollBar orientation="horizontal" /> : null}
      {horizontal && vertical ? <ScrollAreaPrimitive.Corner /> : null}
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-px opacity-0 transition-opacity select-none data-hovering:opacity-100 data-scrolling:opacity-100",
        "data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:flex-col",
        "data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-muted-foreground/40 hover:bg-muted-foreground/60"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
