import { ChevronDownIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../../lib/utils.ts";

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default";
};

/**
 * The only select control: a themed native `<select>` (native keyboard, typeahead, mobile
 * pickers and form semantics). `className` sets the wrapper's layout (`w-full` to fill);
 * every other prop goes on the `<select>`. Label it with `<label htmlFor>` or `aria-label`.
 */
function NativeSelect({ className, size = "default", ...props }: NativeSelectProps) {
  return (
    <div
      className={cn(
        "group/native-select relative w-fit shrink-0 has-[select:disabled]:opacity-50",
        className,
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          "h-8 w-full cursor-pointer appearance-none truncate rounded-md border border-input bg-card py-1 pr-7 pl-2 focus-ring transition-colors select-none hover:bg-accent",
          "disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-destructive",
          "data-[size=sm]:h-7 data-[size=sm]:py-0.5",
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        data-slot="native-select-icon"
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground select-none"
      />
    </div>
  );
}

function NativeSelectOption({ className, ...props }: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  );
}

function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  );
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
