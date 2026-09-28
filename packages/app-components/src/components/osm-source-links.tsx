import { ActionButton } from "@osmix/ui";
import { FilesIcon } from "lucide-react";
import type { OsmInfo } from "osmix";
import { useEffectEvent } from "react";

const EXAMPLE_MONACO_PBF_URL =
  "https://trevorgerhardt.github.io/files/487218b69358-1f24d3e4e476/monaco.pbf";

/**
 * Where to get OSM PBF data, plus a one-click Monaco example. No frame of its own; place it in a
 * `SidebarSection`.
 */
export function OsmSourceLinks({
  openOsmPbfUrl,
}: {
  openOsmPbfUrl: (url: string) => Promise<OsmInfo | null>;
}) {
  // The URL load records its own task, so the example needs no wrapper task.
  const useExample = useEffectEvent((): Promise<OsmInfo | null> =>
    openOsmPbfUrl(EXAMPLE_MONACO_PBF_URL),
  );

  return (
    <div className="flex flex-col gap-2">
      <p>Looking for OpenStreetMap PBF data? We recommend the following services:</p>
      <ul className="flex list-disc flex-col gap-1 pl-4">
        <li>
          <a
            href="https://slice.openstreetmap.us/#0/0/0"
            target="_blank"
            rel="noreferrer"
            className="text-info"
          >
            SliceOSM
          </a>
          : Create a slice for any custom bounding box, GeoJSON polygon or multipolygon area.
        </li>
        <li>
          <a
            href="https://download.geofabrik.de"
            target="_blank"
            rel="noreferrer"
            className="text-info"
          >
            Geofabrik Extracts
          </a>
          : Extracts for the world, continents, countries, regions, updated daily.
        </li>
      </ul>
      <ActionButton
        className="w-full"
        icon={<FilesIcon aria-hidden="true" />}
        onAction={useExample}
      >
        Use example Monaco.pbf file
      </ActionButton>
    </div>
  );
}
