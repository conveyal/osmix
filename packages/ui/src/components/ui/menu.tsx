import { Menu as BaseMenu } from "@base-ui/react/menu";
import { CheckIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../../lib/utils.ts";
import { buttonVariants } from "./button.tsx";
import { Separator } from "./separator.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

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

/**
 * An icon-only menu trigger: a ghost icon button whose `label` becomes its `aria-label` and a
 * tooltip, like `IconButton`. Use it instead of `<Button size="icon">` at a call site.
 */
function MenuIconTrigger({
  label,
  icon,
  className,
  tooltipSide = "bottom",
  ...props
}: Omit<React.ComponentProps<typeof BaseMenu.Trigger>, "children"> & {
  /** Accessible name and tooltip text. Required: an icon alone has no name. */
  label: string;
  icon: React.ReactNode;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <BaseMenu.Trigger
            data-slot="menu-trigger"
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), className)}
            aria-label={label}
            {...props}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
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

const menuItemClasses = cn(
  "cursor-pointer rounded-sm px-2 py-1.5 outline-none select-none",
  "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
  "data-disabled:pointer-events-none data-disabled:opacity-50",
);

/** One action. Children may be a label plus a muted description line. */
function MenuItem({ className, ...props }: React.ComponentProps<typeof BaseMenu.Item>) {
  return (
    <BaseMenu.Item
      data-slot="menu-item"
      className={cn("flex flex-col gap-0.5", menuItemClasses, className)}
      {...props}
    />
  );
}

/** Related items with an optional `MenuGroupLabel`. */
function MenuGroup(props: React.ComponentProps<typeof BaseMenu.Group>) {
  return <BaseMenu.Group data-slot="menu-group" {...props} />;
}

/** The section title of a `MenuGroup`. */
function MenuGroupLabel({ className, ...props }: React.ComponentProps<typeof BaseMenu.GroupLabel>) {
  return (
    <BaseMenu.GroupLabel
      data-slot="menu-group-label"
      className={cn(
        "flex items-center gap-1 px-2 py-1.5 font-mono font-bold tracking-wider text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

/** A rule between menu sections. */
function MenuSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return <Separator data-slot="menu-separator" className={cn("my-1", className)} {...props} />;
}

/** The fixed-width check column in front of a check or radio item's label. */
function MenuItemIndicatorColumn({ children }: { children: React.ReactNode }) {
  return <span className="flex size-4 shrink-0 items-center justify-center">{children}</span>;
}

/** A setting that toggles on and off; the menu stays open. */
function MenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenu.CheckboxItem>) {
  return (
    <BaseMenu.CheckboxItem
      data-slot="menu-checkbox-item"
      closeOnClick={false}
      className={cn("flex items-center gap-2", menuItemClasses, className)}
      {...props}
    >
      <MenuItemIndicatorColumn>
        <BaseMenu.CheckboxItemIndicator>
          <CheckIcon aria-hidden="true" className="size-3.5" />
        </BaseMenu.CheckboxItemIndicator>
      </MenuItemIndicatorColumn>
      {children}
    </BaseMenu.CheckboxItem>
  );
}

/** Mutually exclusive `MenuRadioItem`s; control it with `value` and `onValueChange`. */
function MenuRadioGroup(props: React.ComponentProps<typeof BaseMenu.RadioGroup>) {
  return <BaseMenu.RadioGroup data-slot="menu-radio-group" {...props} />;
}

/** One option of a `MenuRadioGroup`; the menu stays open. */
function MenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenu.RadioItem>) {
  return (
    <BaseMenu.RadioItem
      data-slot="menu-radio-item"
      closeOnClick={false}
      className={cn("flex items-center gap-2", menuItemClasses, className)}
      {...props}
    >
      <MenuItemIndicatorColumn>
        <BaseMenu.RadioItemIndicator>
          <CheckIcon aria-hidden="true" className="size-3.5" />
        </BaseMenu.RadioItemIndicator>
      </MenuItemIndicatorColumn>
      {children}
    </BaseMenu.RadioItem>
  );
}

export {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuIconTrigger,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
};
