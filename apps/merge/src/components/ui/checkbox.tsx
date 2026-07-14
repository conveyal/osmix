import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../../lib/utils";

function Checkbox({ className, ...props }: React.ComponentProps<typeof BaseCheckbox.Root>) {
  return (
    <BaseCheckbox.Root
      data-slot="checkbox"
      className={cn(
        "peer size-3.5 shrink-0 cursor-pointer rounded-sm border border-input bg-background shadow-xs outline-none",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator className="flex items-center justify-center text-current">
        <CheckIcon className="size-3" />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

/**
 * Label wrapper for a Checkbox with trailing text. Replaces the old `.filters` global CSS.
 */
function CheckboxLabel({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="checkbox-label"
      className={cn("inline-flex cursor-pointer items-center gap-1.5", className)}
      {...props}
    />
  );
}

export { Checkbox, CheckboxLabel };
