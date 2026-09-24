import {
  layerControlIsOpenAtom,
  osmFileControlIsOpenAtom,
  routingControlIsOpenAtom,
  searchControlIsOpenAtom,
} from "@osmix/app-core";
import { ButtonGroupSeparator, ToggleButton } from "@osmix/ui";
import { FilesIcon, LayersIcon, NavigationIcon, SearchIcon } from "lucide-react";

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
        <NavigationIcon aria-hidden="true" />
        <span className="sr-only">Routing panel</span>
      </ToggleButton>
      <ToggleButton atom={layerControlIsOpenAtom}>
        <LayersIcon aria-hidden="true" />
        <span className="sr-only">Layers panel</span>
      </ToggleButton>
      <ToggleButton atom={searchControlIsOpenAtom}>
        <SearchIcon aria-hidden="true" />
        <span className="sr-only">Place search panel</span>
      </ToggleButton>
      <ToggleButton atom={osmFileControlIsOpenAtom}>
        <FilesIcon aria-hidden="true" />
        <span className="sr-only">Files panel</span>
      </ToggleButton>
      <ButtonGroupSeparator />
      <div className="px-2 font-mono whitespace-nowrap tabular-nums">
        <CenterInfo />
      </div>
      <ButtonGroupSeparator />
      <div className="flex items-center gap-1">
        <ZoomOutButton />
        <div className="font-mono tabular-nums">
          z<ZoomInfo />
        </div>
        <ZoomInButton />
      </div>
    </>
  );
}
