import { type PrimitiveAtom, useAtom } from "jotai";
import type { ReactNode } from "react";

import { cn } from "../lib/utils.ts";
import { ButtonGroup } from "./ui/button-group.tsx";
import { Button } from "./ui/button.tsx";

/**
 * Top navigation bar shell shared by the Osmix apps. Apps supply the pieces that differ:
 * `links` renders after the brand, `status` sits in the middle, and `controls` fills the
 * right-hand button group.
 */
export function Nav({
  brand = "OSMIX",
  links,
  status,
  controls,
}: {
  brand?: ReactNode;
  links?: ReactNode;
  status?: ReactNode;
  controls?: ReactNode;
}) {
  return (
    <nav
      data-slot="nav"
      className="z-20 flex h-10 flex-row items-center justify-between border-b bg-card px-2 shadow-raised lg:px-4"
    >
      <div className="flex flex-row items-center gap-2">
        <a
          href="https://github.com/conveyal/osmix"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Osmix on GitHub"
          className="size-4 rounded-sm focus-ring hover:opacity-60"
        >
          <GithubLogo />
        </a>
        <div className="flex flex-row items-center gap-3 pr-2">
          <span
            data-slot="nav-brand"
            className="flex items-center gap-1.5 font-mono font-bold tracking-widest"
          >
            <span aria-hidden="true" className="brand-mark" />
            {brand}
          </span>
          {links}
        </div>
      </div>

      {status}

      <ButtonGroup className="flex h-full flex-row items-center gap-1">{controls}</ButtonGroup>
    </nav>
  );
}

/** Icon button bound to a boolean atom, used for the nav's panel toggles. On = info. */
export function ToggleButton({
  atom,
  children,
}: {
  atom: PrimitiveAtom<boolean>;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useAtom(atom);
  return (
    <Button
      className={cn(isOpen ? "text-info" : "text-muted-foreground")}
      size="icon-sm"
      variant="ghost"
      aria-pressed={isOpen}
      onClick={() => setIsOpen((o) => !o)}
    >
      {children}
    </Button>
  );
}

export function GithubLogo() {
  return (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <title>GitHub</title>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
