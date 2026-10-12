import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils.ts";

const fieldVariants = cva("group/field flex w-full gap-1.5", {
  variants: {
    orientation: {
      /** Label, then control, then description, stacked. */
      vertical: "flex-col",
      /** Label and description on the left, the control on the right (compact settings). */
      horizontal: "flex-row items-start justify-between gap-3",
    },
  },
  defaultVariants: { orientation: "vertical" },
});

/**
 * One form control with its label and optional help text (shadcn's `Field`, trimmed). The only
 * way to lay out a labelled control: no boxes, the label in `font-medium`, help text muted.
 * Horizontal fields put `FieldContent` (label + description) beside the control.
 */
function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  );
}

/** Groups a label and description beside a horizontal field's control. */
function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="field-label"
      className={cn(
        "w-fit font-medium group-has-[:disabled]/field:opacity-50 has-[+:disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("leading-normal text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Field, FieldContent, FieldDescription, FieldLabel };
