import {
  NativeImage,
  resolveImageRenderProtocol,
  type CliRenderer,
  type ImageRenderProtocol,
  type OptimizedBuffer,
  type TerminalCapabilities,
} from "@opentui/core";

const DEFAULT_CELL_PIXEL_WIDTH = 8;
const DEFAULT_CELL_PIXEL_HEIGHT = 16;
const MAX_TEXTURE_DIMENSION = 2_048;
const MAX_TEXTURE_PIXELS = 2_000_000;
const GPU_BUFFER_MAP_READ = 0x0001;
const GPU_BUFFER_COPY_DST = 0x0008;
const GPU_MAP_READ = 0x0001;

export type VectorOutputMode = "kitty" | "sixel" | "quadrants";

export interface VectorPixelSize {
  height: number;
  width: number;
}

interface PixelSizeOptions {
  maxDimension?: number;
  maxPixels?: number;
}

interface PixelCanvasContext {
  getCurrentTexture(): GPUTexture;
  switchTextures(): void;
}

interface PixelCanvas {
  device: GPUDevice;
  gpuCanvasContext: PixelCanvasContext;
  height: number;
  readPixelsIntoBuffer(buffer: OptimizedBuffer): Promise<void>;
  setSize(width: number, height: number): void;
  setSuperSample(superSample: "none" | "gpu" | "cpu"): void;
  width: number;
}

interface ThreeRendererInternals {
  canvas?: PixelCanvas;
  outputHeight: number;
  outputWidth: number;
  renderHeight: number;
  renderWidth: number;
  superSample: "none" | "gpu" | "cpu";
  threeRenderer?: {
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setViewport(x: number, y: number, width: number, height: number): void;
  };
}

function requestedImageProtocol(
  environment: Record<string, string | undefined>,
): ImageRenderProtocol {
  if (environment["OPENTUI_GRAPHICS"] === "false") return "blocks";
  const value = environment["OPENTUI_IMAGE_PROTOCOL"];
  if (value === "kitty" || value === "sixel" || value === "blocks") return value;
  return "auto";
}

export function resolveVectorOutputMode(
  capabilities: TerminalCapabilities | null,
  hasResolution: boolean,
  environment: Record<string, string | undefined> = process.env,
): VectorOutputMode {
  const protocol = resolveImageRenderProtocol(
    requestedImageProtocol(environment),
    capabilities,
    hasResolution,
  );
  return protocol === "kitty" || protocol === "sixel" ? protocol : "quadrants";
}

/** Calculate a map texture at terminal-pixel resolution, with a guard against huge readbacks. */
export function vectorPixelSize(
  cellWidth: number,
  cellHeight: number,
  terminalWidth: number,
  terminalHeight: number,
  resolution: VectorPixelSize | null,
  options: PixelSizeOptions = {},
): VectorPixelSize {
  const pixelWidthPerCell =
    resolution && terminalWidth > 0 ? resolution.width / terminalWidth : DEFAULT_CELL_PIXEL_WIDTH;
  const pixelHeightPerCell =
    resolution && terminalHeight > 0
      ? resolution.height / terminalHeight
      : DEFAULT_CELL_PIXEL_HEIGHT;
  let width = Math.max(1, Math.round(Math.max(1, cellWidth) * pixelWidthPerCell));
  let height = Math.max(1, Math.round(Math.max(1, cellHeight) * pixelHeightPerCell));
  const maxDimension = Math.max(1, options.maxDimension ?? MAX_TEXTURE_DIMENSION);
  const maxPixels = Math.max(1, options.maxPixels ?? MAX_TEXTURE_PIXELS);
  const scale = Math.min(
    1,
    maxDimension / width,
    maxDimension / height,
    Math.sqrt(maxPixels / (width * height)),
  );
  if (scale < 1) {
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }
  return { height, width };
}

function isBgraTexture(texture: GPUTexture): boolean {
  return String(Reflect.get(texture, "format")).startsWith("bgra");
}

/**
 * Replaces @opentui/three's quadrant-cell readback with OpenTUI's pixel graphics output.
 * Three still owns WebGPU and scene rendering; this class only changes the final presentation.
 */
export class ThreePixelOutput {
  private activeImage: NativeImage | null = null;
  private canvas: PixelCanvas | null = null;
  private destroyed = false;
  private imageRevision = 0;
  private mode: VectorOutputMode = "quadrants";
  private originalReadPixels: PixelCanvas["readPixelsIntoBuffer"] | null = null;
  private readbackBuffer: GPUBuffer | null = null;
  private readbackInFlight: GPUBuffer | null = null;
  private rgbaPixels = new Uint8Array();
  private sceneRevision = 1;
  private readonly capabilityHandler = (): void => {
    if (this.refresh(this.cellWidth, this.cellHeight)) {
      this.markDirty();
      this.renderer.requestRender();
    }
  };
  private cellHeight: number;
  private cellWidth: number;
  private readonly engine: ThreeRendererInternals;
  private readonly renderer: CliRenderer;

  constructor(renderer: CliRenderer, engine: object, cellWidth: number, cellHeight: number) {
    this.renderer = renderer;
    this.engine = engine as ThreeRendererInternals;
    this.cellWidth = cellWidth;
    this.cellHeight = cellHeight;
    this.renderer.on("capabilities", this.capabilityHandler);
    this.refresh(cellWidth, cellHeight);
  }

  get outputMode(): VectorOutputMode {
    return this.mode;
  }

  markDirty(): void {
    this.sceneRevision++;
  }

  /** Returns true when the output protocol or physical render size changed. */
  refresh(cellWidth: number, cellHeight: number): boolean {
    if (this.destroyed) return false;
    this.cellWidth = Math.max(1, cellWidth);
    this.cellHeight = Math.max(1, cellHeight);
    const nextMode = resolveVectorOutputMode(
      this.renderer.capabilities,
      Boolean(this.renderer.resolution),
    );
    if (nextMode === "quadrants") return false;
    const modeChanged = this.mode !== nextMode;
    this.mode = nextMode;
    this.install();
    return this.resizeTexture() || modeChanged;
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.off("capabilities", this.capabilityHandler);
    if (this.canvas && this.originalReadPixels) {
      this.canvas.readPixelsIntoBuffer = this.originalReadPixels;
    }
    this.activeImage?.dispose();
    this.activeImage = null;
    this.retireReadbackBuffer();
    this.readbackBuffer = null;
    this.canvas = null;
  }

  private install(): void {
    if (this.canvas) return;
    const canvas = this.engine.canvas;
    if (!canvas || !this.engine.threeRenderer) {
      throw Error("The initialized Three renderer does not expose its WebGPU canvas.");
    }
    this.canvas = canvas;
    this.originalReadPixels = canvas.readPixelsIntoBuffer.bind(canvas);
    this.engine.superSample = "none";
    canvas.setSuperSample("none");
    canvas.readPixelsIntoBuffer = (buffer) => this.readPixelsIntoBuffer(buffer);
  }

  private resizeTexture(): boolean {
    const canvas = this.canvas;
    const threeRenderer = this.engine.threeRenderer;
    if (!canvas || !threeRenderer) return false;
    const deviceLimit = canvas.device.limits.maxTextureDimension2D;
    const size = vectorPixelSize(
      this.cellWidth,
      this.cellHeight,
      this.renderer.terminalWidth,
      this.renderer.terminalHeight,
      this.renderer.resolution,
      { maxDimension: Math.min(MAX_TEXTURE_DIMENSION, deviceLimit) },
    );
    if (this.engine.renderWidth === size.width && this.engine.renderHeight === size.height) {
      return false;
    }
    this.engine.outputWidth = this.cellWidth;
    this.engine.outputHeight = this.cellHeight;
    this.engine.renderWidth = size.width;
    this.engine.renderHeight = size.height;
    canvas.setSize(size.width, size.height);
    threeRenderer.setSize(size.width, size.height, false);
    threeRenderer.setViewport(0, 0, size.width, size.height);
    this.retireReadbackBuffer();
    this.rgbaPixels = new Uint8Array(size.width * size.height * 4);
    return true;
  }

  private async readPixelsIntoBuffer(buffer: OptimizedBuffer): Promise<void> {
    const canvas = this.canvas;
    if (this.destroyed || !canvas) return;
    if (this.activeImage && this.imageRevision === this.sceneRevision) {
      this.drawActiveImage(buffer);
      return;
    }
    const renderedRevision = this.sceneRevision;
    const width = this.engine.renderWidth;
    const height = this.engine.renderHeight;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const bufferSize = bytesPerRow * height;
    if (!this.readbackBuffer || this.readbackBuffer.size !== bufferSize) {
      this.retireReadbackBuffer();
      this.readbackBuffer = canvas.device.createBuffer({
        label: "Osmix pixel graphics readback",
        size: bufferSize,
        usage: GPU_BUFFER_MAP_READ | GPU_BUFFER_COPY_DST,
      });
    }
    const readbackBuffer = this.readbackBuffer;
    const rgbaPixels = this.rgbaPixels;

    const texture = canvas.gpuCanvasContext.getCurrentTexture();
    canvas.gpuCanvasContext.switchTextures();
    const encoder = canvas.device.createCommandEncoder({ label: "Osmix pixel graphics copy" });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: readbackBuffer, bytesPerRow, rowsPerImage: height },
      { height, width },
    );
    canvas.device.queue.submit([encoder.finish()]);
    this.readbackInFlight = readbackBuffer;
    try {
      await readbackBuffer.mapAsync(GPU_MAP_READ, 0, bufferSize);
      try {
        if (this.destroyed) return;
        const source = new Uint8Array(readbackBuffer.getMappedRange(0, bufferSize));
        const bgra = isBgraTexture(texture);
        for (let y = 0; y < height; y++) {
          const sourceRow = y * bytesPerRow;
          const targetRow = y * width * 4;
          for (let x = 0; x < width; x++) {
            const sourceOffset = sourceRow + x * 4;
            const targetOffset = targetRow + x * 4;
            rgbaPixels[targetOffset] = source[sourceOffset + (bgra ? 2 : 0)]!;
            rgbaPixels[targetOffset + 1] = source[sourceOffset + 1]!;
            rgbaPixels[targetOffset + 2] = source[sourceOffset + (bgra ? 0 : 2)]!;
            rgbaPixels[targetOffset + 3] = source[sourceOffset + 3]!;
          }
        }
      } finally {
        readbackBuffer.unmap();
      }
    } finally {
      this.readbackInFlight = null;
      if (this.readbackBuffer !== readbackBuffer) readbackBuffer.destroy();
    }

    if (
      this.destroyed ||
      renderedRevision !== this.sceneRevision ||
      width !== this.engine.renderWidth ||
      height !== this.engine.renderHeight
    ) {
      this.renderer.requestRender();
      return;
    }
    const nextImage = NativeImage.fromRgba(rgbaPixels, width, height, width * 4);
    this.activeImage?.dispose();
    this.activeImage = nextImage;
    this.imageRevision = renderedRevision;
    this.drawActiveImage(buffer);
  }

  private drawActiveImage(buffer: OptimizedBuffer): void {
    if (!this.activeImage) return;
    const width = this.activeImage.width;
    const height = this.activeImage.height;
    buffer.drawImage(
      this.activeImage,
      0,
      0,
      this.cellWidth,
      this.cellHeight,
      width,
      height,
      0,
      0,
      width,
      height,
      this.mode === "quadrants" ? "blocks" : this.mode,
    );
  }

  private retireReadbackBuffer(): void {
    const buffer = this.readbackBuffer;
    this.readbackBuffer = null;
    if (buffer && buffer !== this.readbackInFlight) buffer.destroy();
  }
}
