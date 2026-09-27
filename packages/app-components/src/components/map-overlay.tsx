import { cn } from "@osmix/ui";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** The map must be at least this wide for the inspector to dock to the right edge. */
export const DOCKED_MIN_WIDTH = 768;

/** Whether the inspector docks to the right edge at `width`; unmeasured (`null`) docks. */
export function isDockedWidth(width: number | null): boolean {
  return width === null || width >= DOCKED_MIN_WIDTH;
}

/**
 * The observed element's border-box width, the same box `getBoundingClientRect()` measures
 * (the content box would be narrower by the root padding).
 */
export function observedBorderBoxWidth(entry: ResizeObserverEntry): number {
  return entry.borderBoxSize?.[0]?.inlineSize ?? entry.target.getBoundingClientRect().width;
}

/** Which panels Esc closes, in order: the search first, then the inspector, then routing. */
export type MapOverlayLayer = "search" | "inspector" | "route";

const ESCAPE_ORDER: readonly MapOverlayLayer[] = ["search", "inspector", "route"];

/** Where the overlay's panels go. `docked` is true when the map is at least 768px wide. */
export interface MapOverlayLayout {
  docked: boolean;
}

export interface MapOverlayActions {
  /** The layers currently registered as open. */
  open: ReadonlySet<MapOverlayLayer>;
  /**
   * Register `layer` as open with the handler that closes it. Returns the unregister function.
   * Registering a layer again replaces its handler.
   */
  register: (layer: MapOverlayLayer, close: () => void) => () => void;
  /** Close the topmost open layer (search, then inspector, then route). True when one closed. */
  closeTop: () => boolean;
}

const LayoutContext = createContext<MapOverlayLayout>({ docked: true });
const ActionsContext = createContext<MapOverlayActions>({
  open: new Set(),
  register: () => () => {},
  closeTop: () => false,
});
const AnnounceContext = createContext<(message: string) => void>(() => {});

/** The overlay's layout: whether the inspector docks to the right edge or the bottom. */
export function useMapOverlayLayout(): MapOverlayLayout {
  return useContext(LayoutContext);
}

/** The Esc stack: register a panel's open state and close handler, or close the top one. */
export function useMapOverlayActions(): MapOverlayActions {
  return useContext(ActionsContext);
}

/**
 * Register `layer` with the Esc stack while `open` is true. `onClose` may change between
 * renders; the latest one runs.
 */
export function useMapOverlayAction(
  layer: MapOverlayLayer,
  open: boolean,
  onClose: () => void,
): void {
  const { register } = useMapOverlayActions();
  const close = useEffectEvent(() => onClose());
  useEffect(() => {
    if (!open) return;
    return register(layer, () => close());
  }, [layer, open, register]);
}

/**
 * Speak a message through the overlay's polite live region: selections, search misses and
 * routing phase changes. A no-op outside `MapOverlay`.
 */
export function useMapAnnounce(): (message: string) => void {
  return useContext(AnnounceContext);
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])") !== null
  );
}

function isInsidePopup(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      '[data-slot="menu-content"], [data-slot="sheet-content"], [role="dialog"], [role="menu"]',
    ) !== null
  );
}

/**
 * The layout owner for everything anchored to the map. Render it as a child of react-map-gl's
 * `Map`: it fills the map (`absolute inset-0`) without catching pointer events, so only the
 * panels inside it (`MapPanel`) are clickable and MapLibre's own bottom-right controls stay
 * reachable. Regions:
 *
 * - `toolbar`: the top-left row (the toolbar, then the search panel when open).
 * - `inspector`: the top-right corner when `docked`, else a strip along the bottom edge.
 * - `legend`: the bottom-left corner.
 * - `children`: extras, positioned by the caller.
 *
 * It measures its own width to decide `docked` (`useMapOverlayLayout`), owns the single Esc
 * dispatcher (`useMapOverlayActions`) and a polite live region (`useMapAnnounce`).
 */
export function MapOverlay({
  toolbar,
  inspector,
  legend,
  children,
}: {
  toolbar?: ReactNode;
  inspector?: ReactNode;
  legend?: ReactNode;
  children?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const layout = useMemo<MapOverlayLayout>(() => ({ docked: isDockedWidth(width) }), [width]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    setWidth(root.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(observedBorderBoxWidth(entry));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // The Esc stack: open layers in state (so panels can react), handlers in a ref (so
  // registering never re-renders the dispatcher).
  const handlersRef = useRef(new Map<MapOverlayLayer, () => void>());
  const [open, setOpen] = useState<ReadonlySet<MapOverlayLayer>>(() => new Set());
  const register = useCallback((layer: MapOverlayLayer, close: () => void) => {
    handlersRef.current.set(layer, close);
    setOpen((prev) => (prev.has(layer) ? prev : new Set(prev).add(layer)));
    return () => {
      if (handlersRef.current.get(layer) !== close) return;
      handlersRef.current.delete(layer);
      setOpen((prev) => {
        if (!prev.has(layer)) return prev;
        const next = new Set(prev);
        next.delete(layer);
        return next;
      });
    };
  }, []);
  const closeTop = useCallback(() => {
    for (const layer of ESCAPE_ORDER) {
      const close = handlersRef.current.get(layer);
      if (close) {
        close();
        return true;
      }
    }
    return false;
  }, []);
  const actions = useMemo<MapOverlayActions>(
    () => ({ open, register, closeTop }),
    [open, register, closeTop],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isTextField(event.target) || isInsidePopup(event.target)) return;
      if (closeTop()) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeTop]);

  // The live region stays mounted; a new key re-inserts the text so repeats are read again.
  const [announcement, setAnnouncement] = useState({ text: "", nonce: 0 });
  const announce = useCallback((text: string) => {
    setAnnouncement((prev) => ({ text, nonce: prev.nonce + 1 }));
  }, []);

  return (
    <LayoutContext value={layout}>
      <ActionsContext value={actions}>
        <AnnounceContext value={announce}>
          <div
            ref={rootRef}
            data-slot="map-overlay"
            data-docked={layout.docked ? "" : undefined}
            className="pointer-events-none absolute inset-0 z-10 p-2"
          >
            <div role="status" aria-live="polite" className="sr-only">
              <span key={announcement.nonce}>{announcement.text}</span>
            </div>
            <div
              data-slot="map-overlay-top-left"
              className="absolute top-2 right-2 left-2 flex items-start gap-2"
            >
              {toolbar}
            </div>
            {layout.docked ? (
              <div
                data-slot="map-overlay-top-right"
                className="absolute top-2 right-2 bottom-16 flex w-full max-w-sm flex-col items-end"
              >
                {inspector}
              </div>
            ) : (
              // Spans the map's height so the inspector's max-height has something to resolve
              // against; the panel sits at the bottom of the strip.
              <div
                data-slot="map-overlay-bottom"
                className="absolute inset-x-2 top-2 bottom-2 flex flex-col justify-end"
              >
                {inspector}
              </div>
            )}
            <div data-slot="map-overlay-bottom-left" className="absolute bottom-2 left-2">
              {legend}
            </div>
            {children}
          </div>
        </AnnounceContext>
      </ActionsContext>
    </LayoutContext>
  );
}

const PANEL_WIDTHS = {
  narrow: "w-72",
  default: "w-full max-w-sm",
  auto: "w-auto",
} as const;

/**
 * A raised card anchored to the map. A panel with a title (the inspector) starts with
 * `MapPanelHeader` and scrolls its content in `MapPanelBody`; the toolbar, the legend and the
 * search panel lay out their rows directly. The overlay region bounds the panel's height.
 * `width` picks `narrow` (18rem), the `default` (fills up to 24rem) or `auto` (content-sized,
 * for the toolbar). `className` is for layout only. It is the one overlay element that takes
 * pointer events, so the map stays draggable around it.
 */
export function MapPanel({
  width = "default",
  className,
  children,
  ...props
}: ComponentProps<"div"> & {
  width?: keyof typeof PANEL_WIDTHS;
}) {
  return (
    <div
      data-slot="map-panel"
      className={cn(
        "pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-md border bg-card shadow-raised",
        PANEL_WIDTHS[width],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
