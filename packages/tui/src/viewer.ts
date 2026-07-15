import { createReadStream } from "node:fs";
import { basename } from "node:path";

import {
  createCliRenderer,
  FrameBufferRenderable,
  MouseButton,
  RGBA,
  type KeyEvent,
  type MouseEvent,
  type OptimizedBuffer,
} from "@opentui/core";
import { fromPbf, progressEventMessage, type GeoBbox2D, type Osm, type ProgressEvent } from "osmix";

import { MapCamera, type MapViewport } from "./camera.ts";
import {
  createOsmTileProvider,
  MAP_BACKGROUND,
  renderMapPixels,
  type TileProvider,
} from "./map-pixels.ts";

const BACKGROUND = RGBA.fromInts(...MAP_BACKGROUND, 255);
const STATUS_BACKGROUND = RGBA.fromHex("#173c2c");
const STATUS_FOREGROUND = RGBA.fromHex("#d6f5df");
const ERROR_FOREGROUND = RGBA.fromHex("#ffb4ab");
const HALF_BLOCK = "▀";

type ViewerState =
  | { kind: "loading"; message: string }
  | { kind: "ready"; osm: Osm; getTile: TileProvider }
  | { kind: "error"; message: string };

function isValidBounds(bounds: GeoBbox2D): boolean {
  return bounds.every(Number.isFinite) && bounds[0] <= bounds[2] && bounds[1] <= bounds[3];
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

class TerminalMapViewer {
  readonly renderer;
  readonly canvas;
  readonly fileName: string;
  readonly colors = new Map<number, RGBA>();
  camera = new MapCamera();
  state: ViewerState = { kind: "loading", message: "Opening file…" };
  dataBounds: GeoBbox2D | null = null;
  dragPoint: { x: number; y: number } | null = null;

  private constructor(renderer: Awaited<ReturnType<typeof createCliRenderer>>, fileName: string) {
    this.renderer = renderer;
    this.fileName = fileName;
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
      onSizeChange: () => queueMicrotask(() => this.draw()),
    });
    this.renderer.root.add(this.canvas);
    this.renderer.keyInput.on("keypress", (key: KeyEvent) => this.handleKey(key));
    this.renderer.on("resize", (width, height) => {
      this.canvas.width = width;
      this.canvas.height = height;
    });
    this.renderer.setTerminalTitle(`osmix — ${fileName}`);
    this.draw();
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
    });
    return new TerminalMapViewer(renderer, fileName);
  }

  setProgress(event: ProgressEvent): void {
    if (this.renderer.isDestroyed) return;
    this.state = { kind: "loading", message: progressEventMessage(event) };
    this.draw();
  }

  setOsm(osm: Osm): void {
    const bounds = osm.bbox();
    if (!isValidBounds(bounds)) {
      throw Error("The PBF contains no nodes to display.");
    }
    this.dataBounds = bounds;
    this.state = { kind: "ready", osm, getTile: createOsmTileProvider(osm) };
    this.fitBounds();
  }

  setError(error: unknown): void {
    if (this.renderer.isDestroyed) return;
    const message = error instanceof Error ? error.message : String(error);
    this.state = { kind: "error", message };
    this.draw();
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
    this.draw();
  }

  private handleKey(key: KeyEvent): void {
    if (key.name === "q" || key.name === "escape") {
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
    this.draw();
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
    this.draw();
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
    this.draw();
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

  private drawMap(buffer: OptimizedBuffer, width: number, rows: number): void {
    if (this.state.kind !== "ready" || rows === 0) {
      buffer.fillRect(0, 0, width, rows, BACKGROUND);
      return;
    }
    const pixelHeight = rows * 2;
    const pixels = renderMapPixels(this.camera, { width, height: pixelHeight }, this.state.getTile);
    for (let row = 0; row < rows; row++) {
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

  private statusText(): string {
    if (this.state.kind === "loading") return `${this.fileName}  ${this.state.message}`;
    if (this.state.kind === "error") return `Error: ${this.state.message}  •  q quit`;
    const [lon, lat] = this.camera.center;
    const stats = this.state.osm.info().stats;
    return `${this.fileName}  z${this.camera.zoom}  ${lat.toFixed(5)}, ${lon.toFixed(5)}  ${stats.nodes.toLocaleString()} nodes  •  arrows/hjkl pan  +/- zoom  drag/wheel  0 fit  q quit`;
  }

  private draw(): void {
    if (this.renderer.isDestroyed) return;
    const buffer = this.canvas.frameBuffer;
    const width = buffer.width;
    const height = buffer.height;
    if (width === 0 || height === 0) return;
    const mapRows = Math.max(0, height - 1);
    this.drawMap(buffer, width, mapRows);
    buffer.fillRect(0, mapRows, width, 1, STATUS_BACKGROUND);
    buffer.drawText(
      truncate(this.statusText(), width),
      0,
      mapRows,
      this.state.kind === "error" ? ERROR_FOREGROUND : STATUS_FOREGROUND,
      STATUS_BACKGROUND,
    );
    this.canvas.requestRender();
  }
}

/** Open a local OSM PBF file in the interactive OpenTUI map viewer. */
export async function openPbfViewer(filePath: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw Error("The osmix viewer requires an interactive terminal.");
  }
  const viewer = await TerminalMapViewer.create(basename(filePath));
  const stream = createReadStream(filePath);
  let loadError: unknown;
  const loading = fromPbf(stream, { id: basename(filePath) }, (event) => viewer.setProgress(event))
    .then((osm) => viewer.setOsm(osm))
    .catch((error: unknown) => {
      if (viewer.renderer.isDestroyed) return;
      loadError = error;
      viewer.setError(error);
    });

  try {
    await viewer.waitUntilClosed();
  } finally {
    stream.destroy();
    await loading;
  }
  if (loadError !== undefined) throw loadError;
}
