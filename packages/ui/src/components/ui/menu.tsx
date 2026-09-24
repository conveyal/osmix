import { Menu as BaseMenu } from "@base-ui/react/menu";
import type * as React from "react";

import { cn } from "../../lib/utils.ts";
import { buttonVariants } from "./button.tsx";

/** A dropdown of actions. Compose `Menu` > `MenuTrigger` + `MenuContent` > `MenuItem`s. */
function Menu(props: React.ComponentProps<typeof BaseMenu.Root>) {
  return <BaseMenu.Root {...props} />;
}

/** The button that opens a menu; styled as a `Button` with the same `variant` names. */
function MenuTrigger({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof BaseMenu.Trigger> & {
  variant?: "default" | "outline" | "secondary" | "ghost";
}) {
  return (
    <BaseMenu.Trigger
      data-slot="menu-trigger"
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  );
}

/** The themed popup (modal elevation) that holds the menu items. */
function MenuContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner className="z-50" sideOffset={4}>
        <BaseMenu.Popup
          data-slot="menu-content"
          className={cn(
            "min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-modal outline-none",
            className,
          )}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

/** One action. Children may be a label plus a muted description line. */
function MenuItem({ className, ...props }: React.ComponentProps<typeof BaseMenu.Item>) {
  return (
    <BaseMenu.Item
      data-slot="menu-item"
      className={cn(
        "flex cursor-pointer flex-col gap-0.5 rounded-sm px-2 py-1.5 outline-none select-none",
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Menu, MenuContent, MenuItem, MenuTrigger };
