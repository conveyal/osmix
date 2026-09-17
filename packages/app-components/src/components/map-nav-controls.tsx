import {
  layerControlIsOpenAtom,
  osmFileControlIsOpenAtom,
  routingControlIsOpenAtom,
  searchControlIsOpenAtom,
} from "@osmix/app-core";
import { ButtonGroupSeparator, ToggleButton } from "@osmix/ui";
import { FilesIcon, Layers, Navigation, SearchIcon } from "lucide-react";

import CenterInfo from "./center-info.tsx";
import ZoomInfo, { ZoomInButton, ZoomOutButton } from "./zoom-info.tsx";

/**
 * The map-related controls for the `Nav` shell's `controls` slot: panel toggles for routing,
 * layers, search and files, the map center readout, and zoom buttons.
 */
export function MapNavControls() {
  return (
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
  );
}
