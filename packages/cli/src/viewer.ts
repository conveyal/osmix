import { basename, resolve } from "node:path";

import {
  createCliRenderer,
  FrameBufferRenderable,
  MouseButton,
  RGBA,
  type KeyEvent,
  type MouseEvent,
  type OptimizedBuffer,
} from "@opentui/core";
import { type GeoBbox2D, type OsmInfo } from "osmix";

import { MapCamera, type MapViewport } from "./camera.ts";
import {
  layoutMapLabels,
  truncateLabelText,
  type MapLabelCandidate,
  type MapLabelKind,
  type MeasuredLabelText,
  type PlacedMapLabel,
} from "./map-labels.ts";
import {
  formatTileLoadingStatus,
  isShimmerCell,
  MAP_BACKGROUND,
  OsmTileLoader,
  type PendingTileRegion,
  renderMapPixels,
  TILE_LOADING_HIGHLIGHT,
} from "./map-pixels.ts";
import {
  createStyledTileRenderer,
  type StyledTileRenderer,
  type TileRenderingMode,
} from "./tile-renderer.ts";

const BACKGROUND = RGBA.fromInts(...MAP_BACKGROUND, 255);
const STATUS_BACKGROUND = RGBA.fromHex("#173c2c");
const STATUS_FOREGROUND = RGBA.fromHex("#d6f5df");
const ERROR_FOREGROUND = RGBA.fromHex("#ffb4ab");
const LABEL_BACKGROUND = RGBA.fromHex("#101713");
const SHIMMER_HIGHLIGHT = RGBA.fromInts(...TILE_LOADING_HIGHLIGHT, 255);
const LABEL_COLORS = {
  place: RGBA.fromHex("#f2ead3"),
  road: RGBA.fromHex("#d6ded8"),
  water: RGBA.fromHex("#9bcbe4"),
  site: RGBA.fromHex("#b6d5b8"),
  poi: RGBA.fromHex("#efd0a8"),
} satisfies Record<MapLabelKind, RGBA>;
const HALF_BLOCK = "▀";
const ANIMATION_INTERVAL_MS = 100;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

type ViewerRenderer = Awaited<ReturnType<typeof createCliRenderer>>;

interface ViewerTestHooks {
  onStaticCompose?: () => void;
}

type ViewerState =
  | { kind: "loading"; message: string }
  | {
      info: OsmInfo;
      kind: "ready";
      tileRenderer: StyledTileRenderer;
      tiles: OsmTileLoader;
    }
  | { kind: "error"; message: string };

function isValidBounds(bounds: GeoBbox2D): boolean {
  return bounds.every(Number.isFinite) && bounds[0] <= bounds[2] && bounds[1] <= bounds[3];
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

export function animationPhase(now = performance.now()): number {
  return Math.floor(now / ANIMATION_INTERVAL_MS);
}

export function viewerShouldAnimate(
  stateKind: ViewerState["kind"],
  pendingCount: number,
  labelsPending = false,
): boolean {
  return stateKind === "loading" || (stateKind === "ready" && (pendingCount > 0 || labelsPending));
}

export function formatRenderingModeStatus(_mode: TileRenderingMode): string {
  return "";
}

/** Interactive viewer whose OpenTUI thread only composes prepared pixels and text. */
export class TerminalMapViewer {
  readonly renderer: ViewerRenderer;
  readonly canvas: FrameBufferRenderable;
  readonly fileName: string;
  readonly colors = new Map<number, RGBA>();
  camera = new MapCamera();
  state: ViewerState = { kind: "loading", message: "Opening file…" };
  dataBounds: GeoBbox2D | null = null;
  dragPoint: { x: number; y: number } | null = null;

  private animationLive = false;
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private cleanedUp = false;
  private labelCandidates: MapLabelCandidate[] = [];
  private labelLayoutDirty = false;
  private labelQueryActive = false;
  private labelQueryQueued: number | null = null;
  private labels: PlacedMapLabel[] = [];
  private pendingRegions: PendingTileRegion[] = [];
  private staticDirty = true;
  private readonly testHooks: ViewerTestHooks;
  private viewportRevision = 0;
  private readonly now: () => number;

  private readonly frameCallback = async (): Promise<void> => {
    if (this.renderer.isDestroyed) return;
    if (this.staticDirty) this.composeStaticFrame();
    this.pumpLabelQuery();
  };

  private readonly postProcess = (buffer: OptimizedBuffer): void => {
    if (this.renderer.isDestroyed) return;
    this.drawDynamicOverlay(buffer, animationPhase(this.now()));
  };

  constructor(
    renderer: ViewerRenderer,
    fileName: string,
    now: () => number = () => performance.now(),
    testHooks: ViewerTestHooks = {},
  ) {
    this.renderer = renderer;
    this.fileName = fileName;
    this.now = now;
    this.testHooks = testHooks;
    this.canvas = new FrameBufferRenderable(renderer, {
      id: "osm-map",
      width: renderer.width,
      height: renderer.height,
      onMouseDown: (event) => this.handleMouseDown(event),
      onMouseUp: () => {
        this.dragPoint = null;
      },
      onMouseDrag: (event) => this.handleMouseDrag(event),
      onMouseDragEnd: () => {
        this.dragPoint = null;
      },
      onMouseScroll: (event) => this.handleMouseScroll(event),
      onSizeChange: () => queueMicrotask(() => this.invalidateViewport()),
    });
    this.renderer.root.add(this.canvas);
    this.renderer.keyInput.on("keypress", (key: KeyEvent) => this.handleKey(key));
    this.renderer.on("resize", (width, height) => {
      this.canvas.width = width;
      this.canvas.height = height;
    });
    this.renderer.setFrameCallback(this.frameCallback);
    this.renderer.addPostProcessFn(this.postProcess);
    this.renderer.once("destroy", () => this.cleanup());
    this.renderer.setTerminalTitle(`osmix — ${fileName}`);
    this.requestStaticFrame();
    this.updateAnimationState();
  }

  static async create(fileName: string): Promise<TerminalMapViewer> {
    const renderer = await createCliRenderer({
      screenMode: "alternate-screen",
      consoleMode: "console-overlay",
      openConsoleOnError: false,
      exitOnCtrlC: true,
      useMouse: true,
      enableMouseMovement: true,
      autoFocus: false,
      backgroundColor: BACKGROUND,
      targetFps: 10,
      maxFps: 30,
    });
    return new TerminalMapViewer(renderer, fileName);
  }

  setProgress(message: string): void {
    if (this.renderer.isDestroyed) return;
    if (this.state.kind !== "loading") return;
    this.state = { kind: "loading", message };
    this.canvas.requestRender();
    this.updateAnimationState();
  }

  setLoadingMessage(message: string): void {
    this.setProgress(message);
  }

  setDataset(info: OsmInfo, tileRenderer: StyledTileRenderer): void {
    if (!isValidBounds(info.bbox)) throw Error("The PBF contains no nodes to display.");
    this.dataBounds = info.bbox;
    const tiles = new OsmTileLoader({
      maxConcurrentTiles: tileRenderer.workerCount,
      onError: (error) => this.setError(error),
      onGenerationChange: (generation) => tileRenderer.cancelBefore(generation),
      onPendingChange: () => {
        this.canvas.requestRender();
        this.updateAnimationState();
      },
      onTileComplete: () => this.requestStaticFrame(),
      renderTile: (tile, generation) => tileRenderer.renderTile(tile, generation),
    });
    this.state = { kind: "ready", info, tileRenderer, tiles };
    this.fitBounds();
  }

  setError(error: unknown): void {
    if (this.renderer.isDestroyed) return;
    if (this.state.kind === "ready") {
      this.state.tiles.dispose();
      this.state.tileRenderer.dispose();
    }
    const message = error instanceof Error ? error.message : String(error);
    this.state = { kind: "error", message };
    this.pendingRegions = [];
    this.labelCandidates = [];
    this.labels = [];
    this.labelQueryActive = false;
    this.labelQueryQueued = null;
    this.requestStaticFrame();
    this.updateAnimationState();
  }

  waitUntilClosed(): Promise<void> {
    if (this.renderer.isDestroyed) return Promise.resolve();
    return new Promise((resolve) => this.renderer.once("destroy", resolve));
  }

  private viewport(): MapViewport {
    return {
      width: this.canvas.frameBuffer.width,
      height: Math.max(0, (this.canvas.frameBuffer.height - 1) * 2),
    };
  }

  private fitBounds(): void {
    if (!this.dataBounds || this.state.kind !== "ready") return;
    this.camera = MapCamera.fitBounds(this.dataBounds, this.viewport());
    this.invalidateViewport();
  }

  private handleKey(key: KeyEvent): void {
    if (key.name === "q" || key.name === "escape") {
      this.cleanup();
      this.renderer.destroy();
      return;
    }
    if (this.state.kind !== "ready") return;

    const viewport = this.viewport();
    const panX = Math.max(1, Math.floor(viewport.width / 4));
    const panY = Math.max(1, Math.floor(viewport.height / 4));
    switch (key.name) {
      case "left":
      case "h":
        this.camera.panPixels(-panX, 0);
        break;
      case "right":
      case "l":
        this.camera.panPixels(panX, 0);
        break;
      case "up":
      case "k":
        this.camera.panPixels(0, -panY);
        break;
      case "down":
      case "j":
        this.camera.panPixels(0, panY);
        break;
      case "+":
      case "=":
      case "kpplus":
        this.camera.zoomBy(1, viewport);
        break;
      case "-":
      case "kpminus":
        this.camera.zoomBy(-1, viewport);
        break;
      case "0":
      case "kp0":
        this.fitBounds();
        return;
      default:
        return;
    }
    this.invalidateViewport();
  }

  private handleMouseDown(event: MouseEvent): void {
    if (event.button !== MouseButton.LEFT || event.y >= this.canvas.frameBuffer.height - 1) return;
    event.preventDefault();
    this.dragPoint = { x: event.x, y: event.y };
  }

  private handleMouseDrag(event: MouseEvent): void {
    if (this.state.kind !== "ready" || !this.dragPoint) return;
    const deltaX = event.x - this.dragPoint.x;
    const deltaY = event.y - this.dragPoint.y;
    this.dragPoint = { x: event.x, y: event.y };
    this.camera.panPixels(-deltaX, -deltaY * 2);
    event.preventDefault();
    event.stopPropagation();
    this.invalidateViewport();
  }

  private handleMouseScroll(event: MouseEvent): void {
    if (this.state.kind !== "ready" || !event.scroll) return;
    if (event.scroll.direction !== "up" && event.scroll.direction !== "down") return;
    const viewport = this.viewport();
    this.camera.zoomBy(event.scroll.direction === "up" ? 1 : -1, viewport, {
      x: event.x,
      y: Math.min(viewport.height, event.y * 2 + 1),
    });
    event.preventDefault();
    event.stopPropagation();
    this.invalidateViewport();
  }

  private color(pixels: Uint8ClampedArray, offset: number): RGBA {
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const key = (red << 16) | (green << 8) | blue;
    let color = this.colors.get(key);
    if (!color) {
      color = RGBA.fromInts(red, green, blue, 255);
      this.colors.set(key, color);
    }
    return color;
  }

  private cleanup(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    if (this.state.kind === "ready") {
      this.state.tiles.dispose();
      this.state.tileRenderer.dispose();
    }
    this.renderer.removeFrameCallback(this.frameCallback);
    this.renderer.removePostProcessFn(this.postProcess);
    if (this.animationTimer) clearInterval(this.animationTimer);
    this.animationTimer = null;
    if (this.animationLive && !this.renderer.isDestroyed) this.renderer.dropLive();
    this.animationLive = false;
  }

  private updateAnimationState(): void {
    if (this.renderer.isDestroyed) return;
    const pendingCount = this.state.kind === "ready" ? this.state.tiles.pendingCount : 0;
    const shouldAnimate = viewerShouldAnimate(
      this.state.kind,
      pendingCount,
      this.labelQueryActive || this.labelQueryQueued !== null,
    );
    if (shouldAnimate && !this.animationLive) {
      this.animationLive = true;
      this.renderer.requestLive();
      this.animationTimer = setInterval(() => {
        if (!this.renderer.isDestroyed) this.canvas.requestRender();
      }, ANIMATION_INTERVAL_MS);
    } else if (!shouldAnimate && this.animationLive) {
      this.animationLive = false;
      if (this.animationTimer) clearInterval(this.animationTimer);
      this.animationTimer = null;
      this.renderer.dropLive();
      this.canvas.requestRender();
    }
  }

  private invalidateViewport(): void {
    if (this.renderer.isDestroyed) return;
    this.viewportRevision++;
    this.labelCandidates = [];
    this.labels = [];
    this.labelLayoutDirty = false;
    if (this.state.kind === "ready") this.labelQueryQueued = this.viewportRevision;
    this.requestStaticFrame();
  }

  private requestStaticFrame(): void {
    if (this.renderer.isDestroyed) return;
    this.staticDirty = true;
    this.canvas.requestRender();
  }

  private composeStaticFrame(): void {
    this.testHooks.onStaticCompose?.();
    this.staticDirty = false;
    const buffer = this.canvas.frameBuffer;
    const width = buffer.width;
    const height = buffer.height;
    if (width === 0 || height === 0) return;
    const mapRows = Math.max(0, height - 1);
    this.pendingRegions = [];
    if (this.state.kind !== "ready" || mapRows === 0) {
      buffer.fillRect(0, 0, width, mapRows, BACKGROUND);
    } else {
      const pixelHeight = mapRows * 2;
      this.state.tiles.beginFrame(this.viewportRevision);
      const pixels = renderMapPixels(
        this.camera,
        { width, height: pixelHeight },
        this.state.tiles.getTile,
        this.pendingRegions,
      );
      this.state.tiles.endFrame();
      for (let row = 0; row < mapRows; row++) {
        for (let column = 0; column < width; column++) {
          const topOffset = (row * 2 * width + column) * 4;
          const bottomOffset = ((row * 2 + 1) * width + column) * 4;
          buffer.setCell(
            column,
            row,
            HALF_BLOCK,
            this.color(pixels, topOffset),
            this.color(pixels, bottomOffset),
          );
        }
      }
    }
    buffer.fillRect(0, mapRows, width, 1, STATUS_BACKGROUND);
    this.updateAnimationState();
  }

  private pumpLabelQuery(): void {
    if (this.labelQueryActive || this.labelQueryQueued === null || this.state.kind !== "ready")
      return;
    if (!this.state.tileRenderer.labelsConcurrent && this.state.tiles.pendingCount > 0) return;

    const revision = this.labelQueryQueued;
    this.labelQueryQueued = null;
    const request = {
      centerX: this.camera.centerX,
      centerY: this.camera.centerY,
      revision,
      viewport: this.viewport(),
      zoom: this.camera.zoom,
    };
    const tileRenderer = this.state.tileRenderer;
    this.labelQueryActive = true;
    this.updateAnimationState();
    void tileRenderer
      .queryLabels(request)
      .then((result) => {
        if (
          this.renderer.isDestroyed ||
          this.state.kind !== "ready" ||
          result.revision !== this.viewportRevision
        )
          return;
        this.labelCandidates = result.candidates;
        this.labelLayoutDirty = true;
        this.canvas.requestRender();
      })
      .catch((error: unknown) => this.setError(error))
      .finally(() => {
        this.labelQueryActive = false;
        if (this.labelQueryQueued !== null) this.canvas.requestRender();
        this.updateAnimationState();
      });
  }

  private measureLabelText(
    buffer: OptimizedBuffer,
    text: string,
    maxWidth: number,
  ): MeasuredLabelText | null {
    const encoded = buffer.encodeUnicode(text);
    if (!encoded) return null;
    try {
      return truncateLabelText(
        text,
        encoded.data.map((character) => character.width),
        maxWidth,
      );
    } finally {
      buffer.freeUnicode(encoded);
    }
  }

  private layoutLabels(buffer: OptimizedBuffer, width: number, mapRows: number): void {
    if (!this.labelLayoutDirty) return;
    this.labelLayoutDirty = false;
    this.labels = layoutMapLabels(
      this.labelCandidates,
      { width, height: mapRows },
      (text, maxWidth) => this.measureLabelText(buffer, text, maxWidth),
    );
  }

  private drawDynamicOverlay(buffer: OptimizedBuffer, phase: number): void {
    const width = buffer.width;
    const height = buffer.height;
    if (width === 0 || height === 0) return;
    const mapRows = Math.max(0, height - 1);

    for (const region of this.pendingRegions) {
      const startX = Math.max(0, Math.floor(region.left));
      const endX = Math.min(width, Math.ceil(region.right));
      const startRow = Math.max(0, Math.floor(region.top / 2));
      const endRow = Math.min(mapRows, Math.ceil(region.bottom / 2));
      for (let row = startRow; row < endRow; row++) {
        for (let column = startX; column < endX; column++) {
          if (isShimmerCell(column, row, phase)) {
            buffer.fillRect(column, row, 1, 1, SHIMMER_HIGHLIGHT);
          }
        }
      }
    }

    this.layoutLabels(buffer, width, mapRows);
    for (const label of this.labels) {
      buffer.fillRect(label.backplateX, label.y, label.backplateWidth, 1, LABEL_BACKGROUND);
      buffer.drawText(label.text, label.x, label.y, LABEL_COLORS[label.kind], LABEL_BACKGROUND);
    }

    buffer.fillRect(0, mapRows, width, 1, STATUS_BACKGROUND);
    buffer.drawText(
      truncate(this.statusText(phase), width),
      0,
      mapRows,
      this.state.kind === "error" ? ERROR_FOREGROUND : STATUS_FOREGROUND,
      STATUS_BACKGROUND,
    );
  }

  private statusText(phase: number): string {
    const spinner = SPINNER_FRAMES[phase % SPINNER_FRAMES.length]!;
    if (this.state.kind === "loading") return `${this.fileName}  ${spinner} ${this.state.message}`;
    if (this.state.kind === "error") return `Error: ${this.state.message}  •  q quit`;
    const [lon, lat] = this.camera.center;
    let activity = "";
    if (this.state.tiles.pendingCount > 0) {
      activity = `  ${formatTileLoadingStatus(this.state.tiles.pendingCount, spinner)}`;
    } else if (this.labelQueryActive) {
      activity = `  ${spinner} Loading labels…`;
    }
    return `${this.fileName}${activity}  z${this.camera.zoom}  ${lat.toFixed(5)}, ${lon.toFixed(5)}  ${this.state.info.stats.nodes.toLocaleString()} nodes  •  arrows/hjkl pan  +/- zoom  drag/wheel  0 fit  q quit`;
  }
}

/** Open a local OSM PBF file in the interactive OpenTUI map viewer. */
export async function openPbfViewer(filePath: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw Error("The osmix viewer requires an interactive terminal.");
  }
  const viewer = await TerminalMapViewer.create(basename(filePath));
  const resources: { tileRenderer?: StyledTileRenderer } = {};
  let loadError: unknown;
  void createStyledTileRenderer({
    onProgress: (message) => viewer.setProgress(message),
  })
    .then(async (created) => {
      resources.tileRenderer = created;
      if (viewer.renderer.isDestroyed) {
        created.dispose();
        return;
      }
      viewer.setLoadingMessage("Loading file in workers…");
      const info = await created.loadPbfFile(resolve(filePath), basename(filePath));
      if (viewer.renderer.isDestroyed) return;
      viewer.setDataset(info, created);
    })
    .catch((error: unknown) => {
      if (viewer.renderer.isDestroyed) return;
      loadError = error;
      resources.tileRenderer?.dispose();
      viewer.setError(error);
    });

  try {
    await viewer.waitUntilClosed();
  } finally {
    resources.tileRenderer?.dispose();
  }
  if (loadError !== undefined) throw loadError;
}
