import type * as React from "react";

import { cn } from "../../lib/utils.ts";
import { ScrollArea } from "./scroll-area.tsx";

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
      className={cn("border-t bg-muted/50 font-bold", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn("hover:bg-muted/50 data-[state=selected]:bg-muted", className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "px-2 py-1 text-left align-top font-mono font-bold tracking-wider text-muted-foreground uppercase first:pl-inset last:pr-inset",
        className,
      )}
      {...props}
    />
  );
}

/**
 * `select-all` is intentional: clicking a cell selects its full value for copying.
 */
function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "overflow-hidden px-2 py-1 align-top font-mono text-ellipsis whitespace-nowrap select-all first:pl-inset last:pr-inset",
        className,
      )}
      {...props}
    />
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

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
