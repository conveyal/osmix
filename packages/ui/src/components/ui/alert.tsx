import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../../lib/utils.ts";

const alertVariants = cva("flex gap-2 p-inset", {
  variants: {
    shape: {
      box: "rounded-md border",
      banner: "border-b",
    },
    variant: {
      info: "border-info/40 bg-info/5 [&>svg]:text-info",
      success: "border-success/40 bg-success/5 [&>svg]:text-success",
      warning: "border-warning/40 bg-warning/5 [&>svg]:text-warning",
      destructive: "border-destructive/40 bg-destructive/5 [&>svg]:text-destructive",
    },
  },
  defaultVariants: { shape: "box", variant: "info" },
});

const ICONS = {
  info: InfoIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  destructive: CircleAlertIcon,
} as const;

/**
 * The only callout box: notices, warnings, failures and confirmations inside the sidebar or a
 * panel. `destructive` defaults to `role="alert"`; the other variants are passive notes. Pass
 * `title` for a bold first line and `action` for a trailing button. `shape="banner"` drops the
 * box for a full-width strip with a bottom rule, for app-level notices under the nav.
 */
function Alert({
  className,
  shape,
  variant = "info",
  title,
  action,
  children,
  role,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> &
  VariantProps<typeof alertVariants> & { title?: React.ReactNode; action?: React.ReactNode }) {
  const Icon = ICONS[variant ?? "info"];
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role={role ?? (variant === "destructive" ? "alert" : undefined)}
      className={cn(alertVariants({ shape, variant }), className)}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? (
          <div data-slot="alert-title" className="font-semibold">
            {title}
          </div>
        ) : null}
        {children}
      </div>
      {action ? <div className="flex shrink-0 items-start">{action}</div> : null}
    </div>
  );
}

export { Alert, alertVariants };
