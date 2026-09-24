import { selectedEntityAtom, selectedOsmAtom } from "@osmix/app-core";
import { EmptyState, IconButton } from "@osmix/ui";
import { useAtom, useSetAtom } from "jotai";
import { MaximizeIcon, MousePointerClickIcon, XIcon } from "lucide-react";
import type { Osm } from "osmix";

import { MIN_PICKABLE_ZOOM } from "../constants.ts";
import { useFlyToEntity } from "../hooks/map.ts";
import { getOsmixEntityByStringId } from "../lib/entity-id.ts";
import EntityDetails from "./entity-details.tsx";
import EntityLookup from "./entity-lookup.tsx";
import { MapPanelBody, MapPanelHeader } from "./map-panel-header.tsx";

/** Map panel content: look up an entity by ID and show the selected entity's details. */
export default function EntityMapControl({ osm }: { osm: Osm }) {
  const [selectedEntity, setSelectedEntity] = useAtom(selectedEntityAtom);
  const setSelectedOsm = useSetAtom(selectedOsmAtom);
  const flyToEntity = useFlyToEntity();
  return (
    <>
      <MapPanelHeader
        icon={<MousePointerClickIcon aria-hidden="true" />}
        title="Entity"
        actions={
          selectedEntity === null ? null : (
            <>
              <IconButton
                onClick={() => flyToEntity(osm, selectedEntity)}
                label="Fit bounds to entity"
                icon={<MaximizeIcon aria-hidden="true" />}
              />
              <IconButton
                onClick={() => setSelectedEntity(null)}
                label="Clear selection"
                icon={<XIcon aria-hidden="true" />}
              />
            </>
          )
        }
      />
      <EntityLookup
        setSelectedEntity={(id) => {
          const entity = getOsmixEntityByStringId(osm, id);
          setSelectedOsm(osm);
          setSelectedEntity(entity);
          if (entity) {
            flyToEntity(osm, entity);
          }
          return entity;
        }}
      />
      <MapPanelBody>
        {selectedEntity === null ? (
          <EmptyState>
            Search by ID or select an entity on the map at zoom {MIN_PICKABLE_ZOOM} and up
          </EmptyState>
        ) : (
          <EntityDetails
            entity={selectedEntity}
            defaultOpen={false}
            osm={osm}
            onSelect={setSelectedEntity}
          />
        )}
      </MapPanelBody>
    </>
  );
}
