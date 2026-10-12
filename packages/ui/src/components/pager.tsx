import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";

/**
 * The only pagination control: previous/next buttons around a "Page X of Y" readout. `page`
 * is zero-based. Renders nothing when everything fits on one page.
 */
export function Pager({
  className,
  page,
  pageCount,
  onPageChange,
  disabled,
  label = "Pagination",
}: {
  className?: string;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav
      data-slot="pager"
      aria-label={label}
      className={cn("flex items-center justify-between gap-2", className)}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || page <= 0}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeftIcon aria-hidden="true" />
        Previous
      </Button>
      <span className="text-muted-foreground" aria-live="polite">
        Page {(page + 1).toLocaleString()} of {pageCount.toLocaleString()}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || page >= pageCount - 1}
        onClick={() => onPageChange(page + 1)}
      >
        Next
        <ChevronRightIcon aria-hidden="true" />
      </Button>
    </nav>
  );
}
