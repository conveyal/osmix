import { useAtom } from "jotai";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils.ts";
import { sidebarIsOpenAtom } from "../state/layout.ts";

export function Main({ children }: { children: ReactNode }) {
  return <div className="flex h-full grow flex-row overflow-hidden">{children}</div>;
}

export function Sidebar({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useAtom(sidebarIsOpenAtom);
  return (
    <div className="group/sidebar relative z-30 flex h-full min-h-0 flex-row">
      <div
        className={cn(
          "flex h-full min-h-0 w-3 flex-col overflow-hidden bg-muted",
          isOpen && "w-xs md:w-sm lg:w-md xl:w-lg",
        )}
      >
        {children}
      </div>
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={cn(
          "absolute right-0 flex h-full w-3 cursor-e-resize items-center justify-center border-r",
          "bg-muted text-muted-foreground focus-ring hover:bg-accent hover:text-foreground",
          isOpen && "cursor-w-resize",
        )}
        aria-label={isOpen ? "Close sidebar" : "Open sidebar"}
      >
        {isOpen ? (
          <ChevronLeftIcon aria-hidden="true" className="size-3" />
        ) : (
          <ChevronRightIcon aria-hidden="true" className="size-3" />
        )}
      </button>
    </div>
  );
}

/**
 * The standard sidebar body: a scrolling column of sections with the shared `p-2 lg:p-4`
 * gutter and `gap-2` rhythm, plus an optional pinned footer (the activity log).
 */
export function AppSidebar({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <Sidebar>
      <div
        data-slot="app-sidebar-body"
        className="flex flex-1 flex-col gap-2 overflow-y-auto p-2 lg:p-4"
      >
        {children}
      </div>
      {footer}
    </Sidebar>
  );
}

export function MapContent({ children }: { children: ReactNode }) {
  return <div className="relative grow-3 bg-muted-foreground">{children}</div>;
}
