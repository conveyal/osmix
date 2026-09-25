import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { cva } from "class-variance-authority";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, XIcon } from "lucide-react";

import { cn } from "../../lib/utils.ts";
import { Button } from "./button.tsx";

export type ToastVariant = "success" | "info" | "error";

const toastVariants = cva(
  "pointer-events-auto flex w-full gap-2 rounded-md border bg-popover p-inset text-popover-foreground shadow-modal transition-all duration-200 data-ending-style:translate-x-4 data-ending-style:opacity-0 data-starting-style:translate-x-4 data-starting-style:opacity-0",
  {
    variants: {
      variant: {
        success: "border-success/40 [&>svg]:text-success",
        info: "[&>svg]:text-muted-foreground",
        error: "border-destructive/40 [&>svg]:text-destructive",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

const ICONS = {
  success: CircleCheckIcon,
  info: InfoIcon,
  error: CircleAlertIcon,
} as const;

/** The app-wide toast queue. `showToast` adds to it from anywhere, including outside React. */
export const toastManager = ToastPrimitive.createToastManager();

/**
 * Show a toast. Success and info toasts dismiss after `timeout` (4s by default); errors stay
 * until closed. `action` renders a trailing text button, such as "View details".
 */
export function showToast({
  action,
  description,
  timeout,
  title,
  variant = "info",
}: {
  action?: { label: string; onClick: () => void };
  description?: string;
  timeout?: number;
  title: string;
  variant?: ToastVariant;
}) {
  return toastManager.add({
    title,
    description,
    type: variant,
    timeout: timeout ?? (variant === "error" ? 0 : 4_000),
    priority: variant === "error" ? "high" : "low",
    actionProps: action ? { children: action.label, onClick: action.onClick } : undefined,
  });
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  return toasts.map((toast) => {
    const variant: ToastVariant =
      toast.type === "success" || toast.type === "error" ? toast.type : "info";
    const Icon = ICONS[variant];
    return (
      <ToastPrimitive.Root
        key={toast.id}
        toast={toast}
        data-slot="toast"
        data-variant={variant}
        className={toastVariants({ variant })}
      >
        <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        <ToastPrimitive.Content className="flex min-w-0 flex-1 flex-col gap-1">
          <ToastPrimitive.Title className="font-semibold">{toast.title}</ToastPrimitive.Title>
          {toast.description ? (
            <ToastPrimitive.Description className="wrap-break-word text-muted-foreground">
              {toast.description}
            </ToastPrimitive.Description>
          ) : null}
          {toast.actionProps ? (
            <ToastPrimitive.Action
              render={<Button variant="link" size="xs" className="self-start px-0" />}
            />
          ) : null}
        </ToastPrimitive.Content>
        <ToastPrimitive.Close
          aria-label="Dismiss"
          render={<Button variant="ghost" size="icon-xs" className="-mt-1 -mr-1 shrink-0" />}
        >
          <XIcon aria-hidden="true" />
        </ToastPrimitive.Close>
      </ToastPrimitive.Root>
    );
  });
}

/** Mount once near the app root: renders queued toasts in the bottom-right corner. */
export function Toaster() {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} limit={4}>
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport
          data-slot="toast-viewport"
          className={cn(
            "pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col-reverse gap-2",
          )}
        >
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}
