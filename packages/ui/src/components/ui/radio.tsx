import type * as React from "react";

import { cn } from "../../lib/utils.ts";

/**
 * The only radio control: a themed native `<input type="radio">`, so arrow-key navigation,
 * form semantics and focus retention during async commits stay native. Group radios in a
 * `<fieldset>` with a `<legend>` and a shared `name`.
 */
function Radio({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="radio"
      data-slot="radio"
      className={cn(
        "size-3.5 shrink-0 cursor-pointer appearance-none rounded-full border border-input bg-card focus-ring",
        "checked:border-4 checked:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** A plain radio row: the radio plus its label text. */
function RadioLabel({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="radio-label"
      className={cn("flex min-h-8 cursor-pointer items-center gap-2", className)}
      {...props}
    />
  );
}

/**
 * A bordered, selectable option row for mutually exclusive choices with more context than a
 * label (a title, a description, an info tooltip). Put a `Radio` first inside it.
 */
function RadioCard({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="radio-card"
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md border bg-card p-2 transition-colors hover:bg-accent",
        "has-checked:border-info has-checked:bg-info/5 has-disabled:cursor-not-allowed has-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Radio, RadioCard, RadioLabel };
