import {
  layerControlIsOpenAtom,
  osmFileControlIsOpenAtom,
  routingControlIsOpenAtom,
  searchControlIsOpenAtom,
} from "@osmix/app-core";
import { NavSeparator, ToggleButton } from "@osmix/ui";
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
      <ToggleButton
        atom={routingControlIsOpenAtom}
        label="Routing panel"
        icon={<NavigationIcon />}
      />
      <ToggleButton atom={layerControlIsOpenAtom} label="Layers panel" icon={<LayersIcon />} />
      <ToggleButton
        atom={searchControlIsOpenAtom}
        label="Place search panel"
        icon={<SearchIcon />}
      />
      <ToggleButton atom={osmFileControlIsOpenAtom} label="Files panel" icon={<FilesIcon />} />
      <div className="hidden h-full items-center gap-1 lg:flex">
        <NavSeparator />
        <div className="px-2 font-mono whitespace-nowrap tabular-nums">
          <CenterInfo />
        </div>
        <NavSeparator />
        <ZoomOutButton />
        <div className="font-mono tabular-nums">
          z<ZoomInfo />
        </div>
        <ZoomInButton />
      </div>
    </>
  );
}
