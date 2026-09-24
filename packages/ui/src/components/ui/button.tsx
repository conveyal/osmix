import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils.ts";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap focus-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-card hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // One control height: default buttons match Input and NativeSelect (h-8).
        default: "h-8 px-3 has-[>svg]:px-2.5",
        xs: "h-6 gap-1 rounded-sm px-2 has-[>svg]:px-1.5",
        sm: "h-7 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2",
        lg: "h-9 rounded-md px-4 has-[>svg]:px-3",
        icon: "size-8",
        "icon-xs": "size-6",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  render,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    render?: React.ReactElement;
  }) {
  return useRender({
    render: render ?? <button type="button" />,
    props: {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props,
    },
  });
}

export { Button, buttonVariants };
