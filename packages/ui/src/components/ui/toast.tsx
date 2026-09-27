import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { cva } from "class-variance-authority";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils.ts";
import { useToastAnchor } from "../../state/layout.ts";
import { Button } from "./button.tsx";
import { Spinner } from "./spinner.tsx";

/** `progress` is for work still running: a spinner, no timeout and no close button. */
export type ToastVariant = "success" | "info" | "error" | "progress";

/** base-ui never auto-dismisses a toast of this type, so it carries `progress`. */
const PROGRESS_TYPE = "loading";

interface ToastData {
  actions?: ReactNode;
}

const toastVariants = cva(
  "pointer-events-auto flex w-full gap-2 rounded-md border bg-popover p-inset text-popover-foreground shadow-modal transition-all duration-200 data-ending-style:-translate-y-2 data-ending-style:opacity-0 data-starting-style:-translate-y-2 data-starting-style:opacity-0",
  {
    variants: {
      variant: {
        success: "border-success/40 [&>svg]:text-success",
        info: "[&>svg]:text-muted-foreground",
        error: "border-destructive/40 [&>svg]:text-destructive",
        progress: "[&>svg]:text-muted-foreground",
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
export const toastManager = ToastPrimitive.createToastManager<ToastData>();

/**
 * Show a toast, or replace the one with the same `id` in place (so a `progress` toast can turn
 * into its outcome). Success and info toasts dismiss after `timeout` (4s by default); errors and
 * `progress` stay until closed, and `progress` has no close button. `action` renders a trailing
 * text button, such as "View details"; `actions` renders arbitrary controls in its place.
 * `onClose` runs when the toast closes, whether dismissed or timed out. Returns the toast id.
 */
export function showToast({
  action,
  actions,
  description,
  id,
  onClose,
  timeout,
  title,
  variant = "info",
}: {
  action?: { label: string; onClick: () => void };
  actions?: ReactNode;
  description?: ReactNode;
  id?: string;
  onClose?: () => void;
  timeout?: number;
  title: ReactNode;
  variant?: ToastVariant;
}): string {
  // Every field is set, even to `undefined`, so replacing a toast in place clears the old ones.
  return toastManager.add({
    id,
    title,
    description,
    type: variant === "progress" ? PROGRESS_TYPE : variant,
    timeout: variant === "progress" ? 0 : (timeout ?? (variant === "error" ? 0 : 4_000)),
    priority: variant === "error" ? "high" : "low",
    actionProps: action ? { children: action.label, onClick: action.onClick } : undefined,
    data: { actions },
    onClose,
  });
}

/** Close the toast with this id, if it is still open. */
export function closeToast(id: string) {
  toastManager.close(id);
}

function toastVariant(type: string | undefined): ToastVariant {
  if (type === PROGRESS_TYPE) return "progress";
  return type === "success" || type === "error" ? type : "info";
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager<ToastData>();
  return toasts.map((toast) => {
    const variant = toastVariant(toast.type);
    const actions = toast.data?.actions;
    return (
      <ToastPrimitive.Root
        key={toast.id}
        toast={toast}
        data-slot="toast"
        data-variant={variant}
        className={toastVariants({ variant })}
      >
        {variant === "progress" ? (
          <Spinner aria-hidden="true" role="presentation" className="mt-px size-3.5 shrink-0" />
        ) : (
          <ToastIcon variant={variant} />
        )}
        <ToastPrimitive.Content className="flex min-w-0 flex-1 flex-col gap-1">
          <ToastPrimitive.Title className="font-semibold">{toast.title}</ToastPrimitive.Title>
          {toast.description ? (
            <ToastPrimitive.Description className="wrap-break-word text-muted-foreground">
              {toast.description}
            </ToastPrimitive.Description>
          ) : null}
          {actions ? (
            <div className="flex items-center gap-3">{actions}</div>
          ) : toast.actionProps ? (
            <ToastPrimitive.Action
              render={<Button variant="link" size="xs" className="self-start px-0" />}
            />
          ) : null}
        </ToastPrimitive.Content>
        {variant === "progress" ? null : (
          <ToastPrimitive.Close
            aria-label="Dismiss"
            render={<Button variant="ghost" size="icon-xs" className="-mt-1 -mr-1 shrink-0" />}
          >
            <XIcon aria-hidden="true" />
          </ToastPrimitive.Close>
        )}
      </ToastPrimitive.Root>
    );
  });
}

function ToastIcon({ variant }: { variant: Exclude<ToastVariant, "progress"> }) {
  const Icon = ICONS[variant];
  return <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0" />;
}

/**
 * Mount once near the app root: renders queued toasts, newest first, centred along the top of
 * `MapContent` (`useToastAnchor`), or under the nav when no `MapContent` is mounted. At the
 * supported minimum (a 576px map) the centred 384px column clears the top-left map toolbar.
 */
export function Toaster() {
  const anchor = useToastAnchor();
  return (
    <ToastPrimitive.Provider toastManager={toastManager} limit={4}>
      {/* A `null` container renders nothing; `undefined` falls back to the body. */}
      <ToastPrimitive.Portal container={anchor ?? undefined}>
        <ToastPrimitive.Viewport
          data-slot="toast-viewport"
          className={cn(
            "pointer-events-none left-1/2 z-50 flex w-96 -translate-x-1/2 flex-col gap-2",
            anchor ? "absolute top-2" : "fixed top-[calc(var(--header-height)+0.5rem)]",
          )}
        >
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}
