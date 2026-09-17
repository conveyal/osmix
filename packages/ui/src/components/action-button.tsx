import { atom, useAtom } from "jotai";
import { useTransition } from "react";

import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/spinner.tsx";

const actionPendingAtom = atom(false);

/** Share the pending state across async buttons and other review controls. */
export function useAction() {
  const [isPending, setIsPending] = useAtom(actionPendingAtom);
  const [isTransitioning, startTransition] = useTransition();
  return {
    isPending: isPending || isTransitioning,
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

export default function ActionButton({
  children,
  disabled,
  icon,
  onAction,
  ...props
}: React.ComponentProps<typeof Button> & {
  icon?: React.ReactNode;
  onAction: () => Promise<unknown>;
}) {
  const { isPending, isTransitioning, runAction } = useAction();
  return (
    <Button
      disabled={disabled || isPending}
      onClick={(e) => {
        e.preventDefault();
        runAction(onAction);
      }}
      size={children ? "default" : "icon-sm"}
      {...props}
    >
      {isTransitioning ? <Spinner /> : icon} {children}
    </Button>
  );
}
