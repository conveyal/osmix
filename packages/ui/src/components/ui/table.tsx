import * as React from "react";

import { cn } from "../../lib/utils.ts";
import { Button } from "./button.tsx";
import { ScrollArea } from "./scroll-area.tsx";

/**
 * The horizontal `ScrollArea` is a safety net: cells wrap, so key/value tables never scroll
 * sideways. Only a many-column table too wide for the panel does.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <ScrollArea data-slot="table-container" orientation="horizontal" className="w-full">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom border-collapse", className)}
        {...props}
      />
    </ScrollArea>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t font-semibold [&_tr]:border-b-0", className)}
      {...props}
    />
  );
}

/** A hairline between rows keeps a wrapped value reading as one row, not two. */
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border/60 last:border-b-0 hover:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

const CELL = "px-2 py-1.5 align-baseline leading-snug first:pl-inset last:pr-inset";

/** `numeric` right-aligns the heading over a column of numbers. */
function TableHead({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      data-slot="table-head"
      data-numeric={numeric || undefined}
      className={cn(
        CELL,
        "text-left font-mono font-bold tracking-wider whitespace-nowrap text-muted-foreground uppercase",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The label of a key/value row, as a row header. It takes a fixed share of the width so the
 * values of every key/value table in a panel start at the same x; a long label wraps.
 */
function TableRowHeader({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-row-header"
      scope="row"
      className={cn(CELL, "w-2/5 text-left font-normal text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * Cells wrap, breaking a long unbroken value where needed, so a table never scrolls sideways.
 * `select-all` is intentional: clicking a cell selects its full value for copying. `numeric`
 * right-aligns a number so a column of them lines up by place value (digits are tabular).
 * `mono` is for literal strings compared character by character: tags, IDs. `clamp` shows at
 * most three lines, with a "Show more" button when the value is longer.
 */
function TableCell({
  className,
  numeric = false,
  mono = false,
  clamp = false,
  children,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean; mono?: boolean; clamp?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      data-numeric={numeric || undefined}
      className={cn(
        CELL,
        "wrap-anywhere select-all",
        numeric && "text-right",
        mono && "font-mono",
        className,
      )}
      {...props}
    >
      {clamp ? <ClampedText>{children}</ClampedText> : children}
    </td>
  );
}

/**
 * Three lines of `children`, and a "Show more" toggle only when they overflow. The hidden text
 * stays in the DOM, so selecting the cell still copies the full value.
 */
function ClampedText({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const [expanded, setExpanded] = React.useState(false);
  const [overflows, setOverflows] = React.useState(false);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, children]);

  return (
    <>
      <div ref={ref} id={id} className={cn(!expanded && "line-clamp-3")}>
        {children}
      </div>
      {overflows || expanded ? (
        <Button
          variant="link"
          size="xs"
          className="h-auto select-none"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </>
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-2 text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
};
