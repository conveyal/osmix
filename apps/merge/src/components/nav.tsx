import { BrowserCheck, MapNavControls, Status } from "@osmix/app-components";
import { cn, Nav } from "@osmix/ui";
import { NavLink, type NavLinkRenderProps } from "react-router";

export default function MergeNav() {
  return (
    <Nav
      links={
        <>
          <NavLink
            to="/"
            end
            className={({ isActive }: NavLinkRenderProps) =>
              cn("font-normal hover:underline", isActive ? "text-info" : "text-muted-foreground")
            }
          >
            Merge
          </NavLink>
          <BrowserCheck />
        </>
      }
      status={<Status />}
      controls={<MapNavControls />}
    />
  );
}
