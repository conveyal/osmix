import { Progress as BaseProgress } from "@base-ui/react/progress";
import type * as React from "react";

import { cn } from "../../lib/utils";

/**
 * Thin progress bar. Pass `value={null}` for indeterminate (animated sweep).
 */
function Progress({ className, value, ...props }: React.ComponentProps<typeof BaseProgress.Root>) {
  return (
    <BaseProgress.Root data-slot="progress" value={value} {...props}>
      <BaseProgress.Track
        className={cn("block h-1 w-full overflow-hidden rounded-full bg-muted", className)}
      >
        <BaseProgress.Indicator
          className={cn(
            "block h-full rounded-full bg-primary transition-[width]",
            value == null && "w-1/3 animate-progress-indeterminate",
          )}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}

export { Progress };
