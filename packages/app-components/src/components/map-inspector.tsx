import {
  mapInsetAtom,
  mapModeAtom,
  selectedEntityAtom,
  selectedOsmAtom,
  selectionOriginAtom,
  selectOsmEntityAtom,
} from "@osmix/app-core";
import { IconButton } from "@osmix/ui";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { CircleDotIcon, MaximizeIcon, ShapesIcon, SplineIcon, XIcon } from "lucide-react";
import type { Osm, OsmEntity, OsmEntityType } from "osmix";
import { getEntityType } from "osmix";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
} from "react";

import { useFlyToEntity, useMap, useSelectAndFlyToEntity } from "../hooks/map.ts";
import { exitRoutingModeAtom } from "../state/routing.ts";
import EntityDetails from "./entity-details.tsx";
import { type LoadedMapDataset, useMapDatasets } from "./map-datasets.tsx";
import {
  MapPanel,
  useMapAnnounce,
  useMapOverlayAction,
  useMapOverlayLayout,
} from "./map-overlay.tsx";
import { MapPanelBody, MapPanelHeader } from "./map-panel-header.tsx";
import { MapRoleSymbol } from "./map-role-symbol.tsx";
import { MAP_INSPECTOR_TITLE_SLOT } from "./map-search.tsx";
import { RoutingInspector } from "./routing-tool.tsx";

/** What the inspector shows: the routing tool, the selected entity, or nothing. */
export type InspectorView = "route" | "entity" | null;

/**
 * The inspector's view from the map mode and the selection. Route mode wins: entering it clears
 * the selection, and a selection made while routing stays hidden until the tool exits.
 */
export function inspectorView(
  mode: "select" | "route",
  selectedEntity: OsmEntity | null,
): InspectorView {
  if (mode === "route") return "route";
  if (selectedEntity !== null) return "entity";
  return null;
}

/** How much of the map's right edge the docked inspector covers (its width plus gutters). */
const DOCKED_INSPECTOR_INSET_PX = 400;

/**
 * How far to pan the map left so a click at `x` (CSS px from the map's left edge) is not under
 * a panel that covers the rightmost `inset` px of a map `mapWidth` px wide: zero when the point
 * is already clear of it.
 */
export function coveredClickNudge(x: number, mapWidth: number, inset: number): number {
  return Math.max(0, Math.ceil(x - (mapWidth - inset)));
}

const ENTITY_ICONS: Record<OsmEntityType, typeof CircleDotIcon> = {
  node: CircleDotIcon,
  way: SplineIcon,
  relation: ShapesIcon,
};

/** Sentence-case type name for a title. */
function entityTitle(entity: OsmEntity): string {
  const type = getEntityType(entity);
  return `${type.charAt(0).toUpperCase()}${type.slice(1)} ${entity.id}`;
}

/** The element that gets focus when the inspector closes and nothing else claims it. */
function focusMapCanvas(): void {
  document.querySelector<HTMLElement>(".maplibregl-canvas")?.focus();
}

/**
 * The panel anchored to the map that shows the selected entity or, in route mode, the routing
 * tool (on the first visible dataset). Docked (the map is at least 768px wide) it sits under
 * the toolbar and is content-sized up to the column; otherwise it takes a strip along the
 * bottom edge, at most three fifths of the map's height. While docked and open it publishes
 * its width as `mapInsetAtom`, which every fit and flight adds to its padding; the map itself
 * is not moved when the panel opens, except to nudge a map-clicked point out from under it.
 * Esc closes it through the overlay's stack (after the search); closing clears the selection
 * or exits routing, then returns focus to whatever opened it (the search or route button) when
 * that is still in the DOM, else to the map canvas. Selections are announced here, once,
 * through the overlay's live region. "Select node …" in a way's node list (or a relation's
 * member list) selects that entity and flies to it; the panel stays open, and since the list
 * that held the button is gone with the old entity, the new title takes focus so the keyboard
 * does not fall back to the top of the page. Esc still returns to the original opener.
 */
export function MapInspector() {
  const mode = useAtomValue(mapModeAtom);
  const selectedEntity = useAtomValue(selectedEntityAtom);
  const selectedOsm = useAtomValue(selectedOsmAtom);
  const selectOsmEntity = useSetAtom(selectOsmEntityAtom);
  const setMapInset = useSetAtom(mapInsetAtom);
  const exitRouting = useSetAtom(exitRoutingModeAtom);
  const datasets = useMapDatasets();
  const { docked } = useMapOverlayLayout();
  const map = useMap();
  const store = useStore();
  const selectAndFlyToEntity = useSelectAndFlyToEntity();
  const announce = useMapAnnounce();

  const view = inspectorView(mode, selectedEntity);
  const open = view !== null;

  const panelRef = useRef<HTMLDivElement>(null);

  // Remember what had focus when a view opened or the selection changed, to give it back on
  // close: a search selection made while the entity view is already open (after a map click)
  // must still return focus to the search button. A change made from inside the panel (a
  // way-node pick) keeps the original opener. A close that only switches views (exiting
  // routing with an entity still selected) keeps the panel, so the pending restore is dropped.
  const openerRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(false);
  useEffect(() => {
    if (view === null) return;
    const active = document.activeElement;
    if (
      !(active instanceof HTMLElement) ||
      active === document.body ||
      panelRef.current?.contains(active)
    ) {
      return;
    }
    restoreFocusRef.current = false;
    openerRef.current = active;
  }, [view, selectedEntity, selectedOsm]);

  const close = () => {
    restoreFocusRef.current = true;
    if (view === "route") exitRouting();
    else selectOsmEntity(null, null);
  };
  useMapOverlayAction("inspector", open, close);

  useEffect(() => {
    if (!docked || !open) return;
    setMapInset({ right: DOCKED_INSPECTOR_INSET_PX });
    return () => {
      setMapInset({ right: 0 });
    };
  }, [docked, open, setMapInset]);

  // A map click under where the panel opens would select something the panel then covers.
  // The origin is consumed either way, so a resize to docked cannot replay a stale point.
  useEffect(() => {
    if (view !== "entity") return;
    const origin = store.get(selectionOriginAtom);
    if (origin.source !== "map") return;
    store.set(selectionOriginAtom, { source: "other" });
    if (!map || !docked) return;
    const mapWidth = map.getContainer().clientWidth;
    const dx = coveredClickNudge(origin.point[0], mapWidth, DOCKED_INSPECTOR_INSET_PX);
    if (dx > 0) map.panBy([dx, 0], { duration: 200 });
  }, [docked, map, selectedEntity, store, view]);

  const dataset =
    selectedOsm === null ? undefined : datasets.find((entry) => entry.osm === selectedOsm);
  useEffect(() => {
    if (view !== "entity" || !selectedEntity) return;
    const label = dataset?.label ?? "dataset";
    announce(`Selected ${getEntityType(selectedEntity)} ${selectedEntity.id} from ${label}`);
  }, [announce, dataset?.label, selectedEntity, view]);

  // When the panel goes away with focus inside it, or because it was closed on purpose, put
  // focus back on the opener (if it is still in the DOM) or the map canvas.
  const restoreFocus = () => {
    const panel = panelRef.current;
    const hadFocus = panel?.contains(document.activeElement) ?? false;
    if (!hadFocus && !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    const opener = openerRef.current;
    if (opener?.isConnected && !panel?.contains(opener)) opener.focus();
    else focusMapCanvas();
  };

  // When one view replaces another (a search selects an entity while routing) and focus was
  // inside the panel, the browser drops it on the body; the new view's title takes it instead.
  const focusWithinRef = useRef(false);

  if (view === null) return null;
  // Routing works on a visible dataset: a hidden one draws nothing to click on.
  const routingDataset = datasets.find((entry) => entry.visible);
  return (
    <InspectorPanel ref={panelRef} docked={docked} onUnmount={restoreFocus}>
      <InspectorViewFocus key={view} panelRef={panelRef} focusWithinRef={focusWithinRef}>
        {view === "route" ? (
          routingDataset ? (
            <RoutingInspector dataset={routingDataset} />
          ) : null
        ) : selectedEntity ? (
          <EntityInspector
            entity={selectedEntity}
            osm={selectedOsm}
            dataset={dataset}
            showRole={datasets.length > 1}
            onSelect={(entity) => {
              // The lists only render with a dataset, so `selectedOsm` is set here.
              if (!selectedOsm) return;
              selectAndFlyToEntity(selectedOsm, entity);
              // The button that was activated unmounts with the old entity's list, which drops
              // focus on the body; the new title takes it once the new view has rendered. The
              // opener recorded when the panel opened is kept, so Esc still returns there.
              requestAnimationFrame(() => {
                panelRef.current
                  ?.querySelector<HTMLElement>(`[data-slot="${MAP_INSPECTOR_TITLE_SLOT}"]`)
                  ?.focus();
              });
            }}
            onClose={close}
          />
        ) : null}
      </InspectorViewFocus>
    </InspectorPanel>
  );
}

/**
 * Keyed by the view, so it unmounts with the old view and mounts with the new one. Its layout
 * cleanup runs before the old view leaves the DOM, so it can still see whether focus was
 * inside the panel; on mount, if it was and focus has landed on the body or outside the panel,
 * the new title takes it. The panel ref is read when each side runs, never captured: React
 * runs a child's layout effect before it attaches the parent's ref, so on the view the panel
 * mounts with, the ref is still null at effect time but set by the time the cleanup runs.
 */
function InspectorViewFocus({
  panelRef,
  focusWithinRef,
  children,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  focusWithinRef: RefObject<boolean>;
  children: ReactNode;
}) {
  const panelHasFocus = useEffectEvent(
    () => panelRef.current?.contains(document.activeElement) ?? false,
  );
  useLayoutEffect(() => {
    if (focusWithinRef.current) {
      focusWithinRef.current = false;
      const panel = panelRef.current;
      const active = document.activeElement;
      if (active === document.body || !panel?.contains(active)) {
        panel?.querySelector<HTMLElement>(`[data-slot="${MAP_INSPECTOR_TITLE_SLOT}"]`)?.focus();
      }
    }
    return () => {
      focusWithinRef.current = panelHasFocus();
    };
  }, [focusWithinRef, panelRef]);
  return children;
}

function InspectorPanel({
  ref,
  docked,
  onUnmount,
  children,
}: {
  ref: RefObject<HTMLDivElement | null>;
  docked: boolean;
  onUnmount: () => void;
  children: ReactNode;
}) {
  // A layout effect cleanup runs while the panel is still in the DOM, so `onUnmount` can see
  // whether focus was inside it.
  const unmount = useEffectEvent(() => onUnmount());
  useLayoutEffect(() => () => unmount(), []);

  return (
    <MapPanel
      ref={ref}
      width={docked ? "default" : "auto"}
      data-slot="map-inspector"
      role="region"
      aria-label="Inspector"
      className={docked ? "min-h-0 shrink" : "max-h-3/5 min-h-0 w-full"}
    >
      {children}
    </MapPanel>
  );
}

function EntityInspector({
  entity,
  osm,
  dataset,
  showRole,
  onSelect,
  onClose,
}: {
  entity: OsmEntity;
  osm: Osm | null;
  dataset: LoadedMapDataset | undefined;
  /** Name the role after the label, as the legend does when labels could collide. */
  showRole: boolean;
  onSelect: (entity: OsmEntity) => void;
  onClose: () => void;
}) {
  const flyToEntity = useFlyToEntity();
  const type = getEntityType(entity);
  const Icon = ENTITY_ICONS[type];
  const role = dataset?.role ?? "base";
  const label = dataset?.label ?? "dataset";

  return (
    <>
      <MapPanelHeader
        icon={<Icon aria-hidden="true" />}
        title={
          <span data-slot={MAP_INSPECTOR_TITLE_SLOT} tabIndex={-1}>
            {entityTitle(entity)}
          </span>
        }
        detail={
          <span className="flex min-w-0 items-center gap-1">
            <MapRoleSymbol role={role} />
            <span className="truncate">{label}</span>
            {showRole ? <span className="shrink-0 text-muted-foreground">{role}</span> : null}
          </span>
        }
        actions={
          <>
            <IconButton
              label={`Fit map to ${type}`}
              icon={<MaximizeIcon aria-hidden="true" />}
              disabled={!osm}
              onClick={() => {
                if (osm) flyToEntity(osm, entity);
              }}
            />
            <IconButton
              label="Close inspector"
              icon={<XIcon aria-hidden="true" />}
              onClick={onClose}
            />
          </>
        }
      />
      <MapPanelBody>
        <EntityDetails entity={entity} osm={osm ?? undefined} summary={false} onSelect={onSelect} />
      </MapPanelBody>
    </>
  );
}
