import { Select as BaseSelect } from "@base-ui/react/select";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../../lib/utils.ts";

export type SelectOption<Value extends string> = { value: Value; label: React.ReactNode };

/**
 * The only select control. Themed popup (native `<select>` popups ignore the theme), keyboard
 * and typeahead support from Base UI. Label it with a wrapping `<label>`, `aria-label`, or an
 * `id` referenced by `<label htmlFor>`.
 */
function Select<Value extends string>({
  id,
  className,
  disabled,
  items,
  value,
  onValueChange,
  placeholder,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  className?: string;
  disabled?: boolean;
  items: readonly SelectOption<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  placeholder?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <BaseSelect.Root
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next as Value);
      }}
    >
      <BaseSelect.Trigger
        id={id}
        data-slot="select-trigger"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        className={cn(
          "flex h-8 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-card px-2 text-left focus-ring",
          "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <BaseSelect.Value className="truncate" placeholder={placeholder} />
        <BaseSelect.Icon className="shrink-0 text-muted-foreground">
          <ChevronsUpDownIcon aria-hidden="true" className="size-3.5" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="z-100 outline-none" sideOffset={4}>
          <BaseSelect.Popup
            data-slot="select-popup"
            className="max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-modal"
          >
            <BaseSelect.List>
              {items.map((item) => (
                <BaseSelect.Item
                  key={item.value}
                  value={item.value}
                  data-slot="select-item"
                  className="grid min-h-7 cursor-default grid-cols-[1rem_1fr] items-center gap-1 rounded-sm px-1 outline-none select-none data-disabled:opacity-50 data-highlighted:bg-accent"
                >
                  <BaseSelect.ItemIndicator className="col-start-1">
                    <CheckIcon aria-hidden="true" className="size-3.5" />
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText className="col-start-2">{item.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

export { Select };
