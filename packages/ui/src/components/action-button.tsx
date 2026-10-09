import { atom, useAtom } from "jotai";
import { useTransition } from "react";

import { IconButton } from "./icon-button.tsx";
import { useTaskLock } from "./task-lock.tsx";
import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/spinner.tsx";

const actionPendingAtom = atom(false);

/**
 * Share the pending state across async buttons and other review controls. `isPending` is also
 * set while any task runs (see `TaskLockProvider`), since only one task runs at a time.
 */
export function useAction() {
  const [isPending, setIsPending] = useAtom(actionPendingAtom);
  const [isTransitioning, startTransition] = useTransition();
  const taskLocked = useTaskLock();
  return {
    isPending: isPending || isTransitioning || taskLocked,
    isTransitioning,
    runAction: (action: () => Promise<unknown>) => {
      setIsPending(true);
      startTransition(async () => {
        try {
          await action();
        } finally {
          setIsPending(false);
        }
      });
    },
  };
}

type ActionButtonProps = Omit<React.ComponentProps<typeof Button>, "children"> & {
  icon?: React.ReactNode;
  onAction: () => Promise<unknown>;
} & (
    | { children: React.ReactNode; label?: never }
    | { children?: undefined; label: string; icon: React.ReactNode }
  );

/**
 * A button that runs an async action, showing a spinner and disabling every action button
 * while it runs, or while any task runs. With `children` it is a text button; without, it is an `IconButton` and
 * needs a `label`.
 */
export default function ActionButton({
  children,
  disabled,
  icon,
  label,
  onAction,
  size,
  ...props
}: ActionButtonProps) {
  const { isPending, isTransitioning, runAction } = useAction();
  const shared = {
    disabled: disabled || isPending,
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      runAction(onAction);
    },
    ...props,
  };
  if (children === undefined) {
    return (
      <IconButton
        label={label ?? ""}
        icon={isTransitioning ? <Spinner /> : icon}
        size={size === "icon" || size === "icon-xs" || size === "icon-lg" ? size : "icon-sm"}
        {...shared}
      />
    );
  }
  return (
    <Button size={size} {...shared}>
      {isTransitioning ? <Spinner /> : icon} {children}
    </Button>
  );
}
