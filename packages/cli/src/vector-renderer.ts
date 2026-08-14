import { RGBA, type CliRenderer } from "@opentui/core";
import { SuperSampleType, ThreeRenderable, THREE } from "@opentui/three";
import type { Tile } from "osmix";

import { MapCamera, type MapViewport, TILE_SIZE } from "./camera.ts";
import { MAP_BACKGROUND, OsmTileLoader, type PendingTileRegion } from "./map-pixels.ts";
import type { StyledTileRenderer } from "./tile-renderer.ts";
import { ThreePixelOutput, type VectorOutputMode } from "./vector-output.ts";
import type { VectorGeometryGroup, VectorTilePacket } from "./vector-tile.ts";

interface VisibleTile {
  key: string;
  screenLeft: number;
  screenTop: number;
  tile: Tile;
}

interface TileInstance {
  packet: VectorTilePacket;
  object: THREE.Group;
}

export interface VectorMapSurfaceOptions {
  onError?: (error: unknown) => void;
  onPendingChange?: () => void;
  onTileComplete?: () => void;
}

async function initializeRenderable(view: ThreeRenderable): Promise<void> {
  // ThreeRenderable initializes lazily and intentionally swallows initialization failures. The CLI
  // needs the original rejection at its backend boundary so `auto` can fall back to raster and
  // explicit `vector` mode can fail clearly. Seed the renderable's existing initialization promise
  // before it enters the tree; subsequent frames then reuse this one initialized engine.
  if (!Reflect.has(view, "initPromise")) {
    throw Error(
      "This @opentui/three release does not expose the expected initialization lifecycle.",
    );
  }
  const initialization = view.renderer.init().then(() => true);
  Reflect.set(view, "initPromise", initialization);
  await initialization;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function rgbaColor(color: ArrayLike<number>): THREE.Color {
  return new THREE.Color(color[0]! / 255, color[1]! / 255, color[2]! / 255);
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child: THREE.Object3D) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      for (const material of child.material) material.dispose();
    } else {
      child.material.dispose();
    }
  });
}

function createGroupMesh(group: VectorGeometryGroup): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(group.positions), 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(group.indices), 1));
  const alpha = group.color[3] / 255;
  const material = new THREE.MeshBasicMaterial({
    color: rgbaColor(group.color),
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    transparent: alpha < 1,
    opacity: alpha,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = group.order;
  return mesh;
}

function visibleTiles(camera: MapCamera, viewport: MapViewport): VisibleTile[] {
  const origin = camera.origin(viewport);
  const firstTileX = Math.floor(origin.x / TILE_SIZE);
  const lastTileX = Math.floor((origin.x + viewport.width - 1) / TILE_SIZE);
  const firstTileY = Math.floor(origin.y / TILE_SIZE);
  const lastTileY = Math.floor((origin.y + viewport.height - 1) / TILE_SIZE);
  const tileCount = 2 ** camera.zoom;
  const result: VisibleTile[] = [];
  for (let worldTileY = firstTileY; worldTileY <= lastTileY; worldTileY++) {
    if (worldTileY < 0 || worldTileY >= tileCount) continue;
    for (let worldTileX = firstTileX; worldTileX <= lastTileX; worldTileX++) {
      const tileX = modulo(worldTileX, tileCount);
      result.push({
        key: `${worldTileX}/${worldTileY}/${camera.zoom}`,
        screenLeft: worldTileX * TILE_SIZE - origin.x,
        screenTop: worldTileY * TILE_SIZE - origin.y,
        tile: [tileX, worldTileY, camera.zoom],
      });
    }
  }
  return result;
}

/** Owns the WebGPU scene while OpenTUI continues to own input and overlays. */
export class VectorMapSurface {
  readonly view: ThreeRenderable;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  private readonly activeTiles = new Map<string, TileInstance>();
  private options: VectorMapSurfaceOptions;
  private readonly pixelOutput: ThreePixelOutput;
  private tileLoader: OsmTileLoader<VectorTilePacket> | null = null;
  private destroyed = false;
  private _pendingRegions: PendingTileRegion[] = [];

  private constructor(
    view: ThreeRenderable,
    scene: THREE.Scene,
    camera: THREE.OrthographicCamera,
    pixelOutput: ThreePixelOutput,
    options: VectorMapSurfaceOptions,
  ) {
    this.view = view;
    this.scene = scene;
    this.camera = camera;
    this.pixelOutput = pixelOutput;
    this.options = options;
  }

  static async create(
    renderer: CliRenderer,
    options: VectorMapSurfaceOptions = {},
  ): Promise<VectorMapSurface> {
    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const view = new ThreeRenderable(renderer, {
      autoAspect: false,
      camera,
      height: Math.max(0, renderer.height - 1),
      id: "osm-vector",
      live: false,
      renderer: {
        alpha: false,
        backgroundColor: RGBA.fromInts(...MAP_BACKGROUND, 255),
        superSample: SuperSampleType.GPU,
      },
      scene,
      width: renderer.width,
    });
    try {
      await initializeRenderable(view);
      const pixelOutput = new ThreePixelOutput(renderer, view.renderer, view.width, view.height);
      renderer.root.add(view);
      return new VectorMapSurface(view, scene, camera, pixelOutput, options);
    } catch (error) {
      view.destroy();
      throw error;
    }
  }

  get pendingRegions(): readonly PendingTileRegion[] {
    return this._pendingRegions;
  }

  get pendingCount(): number {
    return this.tileLoader?.pendingCount ?? 0;
  }

  get outputMode(): VectorOutputMode {
    return this.pixelOutput.outputMode;
  }

  setCallbacks(options: VectorMapSurfaceOptions): void {
    this.options = { ...this.options, ...options };
  }

  setTileRenderer(tileRenderer: StyledTileRenderer): void {
    this.tileLoader?.dispose();
    this.tileLoader = new OsmTileLoader<VectorTilePacket>({
      maxConcurrentTiles: tileRenderer.workerCount,
      onError: (error) => this.options.onError?.(error),
      onGenerationChange: (generation) => tileRenderer.cancelBefore(generation),
      onPendingChange: () => this.options.onPendingChange?.(),
      onTileComplete: () => this.options.onTileComplete?.(),
      renderTile: (tile, generation) => tileRenderer.renderVectorTile(tile, generation),
    });
  }

  prepareFrame(camera: MapCamera, viewport: MapViewport, generation: number): void {
    if (this.destroyed || !this.tileLoader) return;
    this.pixelOutput.refresh(this.view.width, this.view.height);
    this.updateCamera({ width: viewport.width, height: viewport.height / 2 });
    this._pendingRegions = [];
    this.tileLoader.beginFrame(generation);
    const visible = visibleTiles(camera, viewport);
    const visibleKeys = new Set(visible.map((tile) => tile.key));
    for (const [key, instance] of this.activeTiles) {
      if (visibleKeys.has(key)) continue;
      this.scene.remove(instance.object);
      disposeObject(instance.object);
      this.activeTiles.delete(key);
    }
    for (const tile of visible) {
      const packet = this.tileLoader.getTile(tile.tile);
      const startX = Math.max(0, tile.screenLeft);
      const endX = Math.min(viewport.width, tile.screenLeft + TILE_SIZE);
      const startY = Math.max(0, tile.screenTop);
      const endY = Math.min(viewport.height, tile.screenTop + TILE_SIZE);
      if (!packet) {
        this._pendingRegions.push({ left: startX, top: startY, right: endX, bottom: endY });
        continue;
      }
      const existing = this.activeTiles.get(tile.key);
      if (existing?.packet !== packet) {
        if (existing) {
          this.scene.remove(existing.object);
          disposeObject(existing.object);
        }
        const object = new THREE.Group();
        object.scale.set(1, 0.5, 1);
        for (const group of packet.groups) object.add(createGroupMesh(group));
        this.scene.add(object);
        this.activeTiles.set(tile.key, { object, packet });
      }
      const instance = this.activeTiles.get(tile.key);
      instance?.object.position.set(tile.screenLeft, tile.screenTop / 2, 0);
    }
    this.tileLoader.endFrame();
    this.pixelOutput.markDirty();
    this.view.requestRender();
  }

  resize(width: number, height: number): void {
    if (this.destroyed) return;
    this.view.width = width;
    this.view.height = height;
    if (this.pixelOutput.refresh(width, height)) this.pixelOutput.markDirty();
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.tileLoader?.dispose();
    this.tileLoader = null;
    for (const instance of this.activeTiles.values()) disposeObject(instance.object);
    this.activeTiles.clear();
    this.pixelOutput.dispose();
    this.view.destroy();
  }

  private updateCamera(viewport: MapViewport): void {
    this.camera.left = 0;
    this.camera.right = viewport.width;
    this.camera.top = 0;
    this.camera.bottom = viewport.height;
    this.camera.near = 0.1;
    this.camera.far = 10;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}
