import {
  layerControlIsOpenAtom,
  osmFileControlIsOpenAtom,
  routingControlIsOpenAtom,
  searchControlIsOpenAtom,
} from "@osmix/app-core";
import { Nav, ToggleButton, cn } from "@osmix/ui";
import { ButtonGroupSeparator } from "@osmix/ui";
import { FilesIcon, Layers, Navigation, SearchIcon } from "lucide-react";
import { NavLink, type NavLinkRenderProps } from "react-router";

import BrowserCheck from "./browser-check";
import CenterInfo from "./center-info";
import Status from "./status";
import ZoomInfo, { ZoomInButton, ZoomOutButton } from "./zoom-info";

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
      controls={
        <>
          <ToggleButton atom={routingControlIsOpenAtom}>
            <Navigation />
          </ToggleButton>
          <ToggleButton atom={layerControlIsOpenAtom}>
            <Layers />
          </ToggleButton>
          <ToggleButton atom={searchControlIsOpenAtom}>
            <SearchIcon />
          </ToggleButton>
          <ToggleButton atom={osmFileControlIsOpenAtom}>
            <FilesIcon />
          </ToggleButton>
          <ButtonGroupSeparator />
          <div className="whitespace-nowrap px-2">
            <CenterInfo />
          </div>
          <ButtonGroupSeparator />
          <div className="flex items-center gap-1">
            <ZoomOutButton />
            <div>
              z<ZoomInfo />
            </div>
            <ZoomInButton />
          </div>
        </>
      }
    />
  );
}
