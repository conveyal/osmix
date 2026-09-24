import { zoomAtom } from "@osmix/app-core";
import { IconButton } from "@osmix/ui";
import { useAtomValue } from "jotai";
import { MinusIcon, PlusIcon } from "lucide-react";

import { useMap } from "../hooks/map.ts";

export default function ZoomInfo() {
  const zoom = useAtomValue(zoomAtom);
  return <>{zoom?.toFixed(2)}</>;
}

export function ZoomInButton() {
  const map = useMap();
  return <IconButton label="Zoom in" icon={<PlusIcon />} onClick={() => map?.zoomIn()} />;
}

export function ZoomOutButton() {
  const map = useMap();
  return <IconButton label="Zoom out" icon={<MinusIcon />} onClick={() => map?.zoomOut()} />;
}
