import { Application, Container, Graphics } from "pixi.js";

import { CozyPixelSpriteAtlasEngine, type AtlasFrameRecord } from "./cozy-pixel-sprite-atlas-engine.js";
import { OfficeCameraController } from "./office-camera-controller.js";
import { paletteForTheme } from "./office-theme-palette.js";
import { OfficeVisibilityController, type TickerLike } from "./office-visibility-controller.js";
import type { ShellThemePort } from "./ports.js";
import type { OfficeRoomId } from "./room-ids.js";
import { TiledFloorPlanLoader } from "./tiled-floor-plan-loader.js";
import type { LoadedFloorPlan, OfficeThemeMode, SpriteDepthLayer } from "./types.js";

export const INTEGER_ZOOM_STEPS = [1, 2, 3, 4] as const;
export const PIXEL_SCALE_MODE_NEAREST = "nearest" as const;

const LAYER_IDS = ["tile", "prop", "character", "badge", "label"] as const;
type OfficeLayerId = (typeof LAYER_IDS)[number];

export type OfficePixiInitOptions = {
  readonly width: number;
  readonly height: number;
  readonly antialias: boolean;
  readonly resolution?: number;
  readonly autoDensity?: boolean;
  readonly preference: "webgl" | "webgpu" | "canvas";
  readonly roundPixels: boolean;
  readonly hello: boolean;
};

export type PixiStageLike = {
  addChild(child: Container): void;
};

export type PixiRendererLike = {
  resize(width: number, height: number): void;
  background: { color: number };
};

export type PixiApplicationLike = {
  init(options: OfficePixiInitOptions): Promise<void>;
  destroy(removeView?: boolean): void;
  renderer: PixiRendererLike;
  stage: PixiStageLike;
  ticker: TickerLike;
  canvas: WebGlCanvas;
};

export type FloorPlanSource = {
  loadFromPath(): Promise<LoadedFloorPlan>;
};

export type AtlasSource = {
  loadFromDisk(): Promise<void>;
  listFrames(): ReadonlyArray<AtlasFrameRecord>;
};

export type OfficePixiViewportOptions = {
  readonly shellTheme: ShellThemePort;
  readonly width: number;
  readonly height: number;
  readonly floorPlanLoader?: FloorPlanSource;
  readonly atlasEngine?: AtlasSource;
  readonly createApplication?: () => PixiApplicationLike;
};

type WebGlCanvas = {
  addEventListener(type: string, listener: (ev: { preventDefault?: () => void }) => void): void;
};

export type OfficeViewportHost = {
  appendChild(node: unknown): void;
};

const BADGE_DEPTHS: ReadonlySet<SpriteDepthLayer> = new Set(["status-icons"]);
const LABEL_DEPTHS: ReadonlySet<SpriteDepthLayer> = new Set(["labels"]);

export class OfficePixiViewport {
  readonly visibility = new OfficeVisibilityController();
  private readonly shellTheme: ShellThemePort;
  private readonly width: number;
  private readonly height: number;
  private readonly floorPlanLoader: FloorPlanSource;
  private readonly atlasEngine: AtlasSource;
  private readonly createApplication: () => PixiApplicationLike;
  private readonly world = new Container();
  private readonly layers = new Map<OfficeLayerId, Container>(
    LAYER_IDS.map((id) => [id, new Container()]),
  );
  private app: PixiApplicationLike | null = null;
  private plan: LoadedFloorPlan | null = null;
  private camera: OfficeCameraController | null = null;
  private theme: OfficeThemeMode = "light";
  private themeUnsub: (() => void) | null = null;
  private contextLost = false;
  private useCanvasFallback = false;
  private frameHook: (() => void) | null = null;

  constructor(options: OfficePixiViewportOptions) {
    this.shellTheme = options.shellTheme;
    this.width = options.width;
    this.height = options.height;
    this.floorPlanLoader = options.floorPlanLoader ?? new TiledFloorPlanLoader();
    this.atlasEngine = options.atlasEngine ?? new CozyPixelSpriteAtlasEngine();
    this.createApplication = options.createApplication ?? (() => new Application() as unknown as PixiApplicationLike);
    this.theme = options.shellTheme.readTheme();
    for (const id of LAYER_IDS) {
      const layer = this.layers.get(id);
      if (layer) this.world.addChild(layer);
    }
  }

  get loadedPlan(): LoadedFloorPlan | null {
    return this.plan;
  }

  get cameraController(): OfficeCameraController | null {
    return this.camera;
  }

  paneSize(): { readonly width: number; readonly height: number } {
    return { width: this.width, height: this.height };
  }

  mountedLayerLabels(): readonly OfficeLayerId[] {
    return LAYER_IDS;
  }

  mountedLayerChildCounts(): readonly number[] {
    return LAYER_IDS.map((id) => this.layers.get(id)?.children.length ?? 0);
  }

  isContextLost(): boolean {
    return this.contextLost;
  }

  usingCanvasFallback(): boolean {
    return this.useCanvasFallback;
  }

  async bootstrap(host: OfficeViewportHost): Promise<void> {
    this.plan = await this.floorPlanLoader.loadFromPath();
    await this.atlasEngine.loadFromDisk();
    this.camera = new OfficeCameraController({
      viewportWidthPx: this.width,
      viewportHeightPx: this.height,
      plan: this.plan,
    });

    const app = this.createApplication();
    const initOptions = {
      width: this.width,
      height: this.height,
      antialias: false,
      resolution: Math.max(1, Math.round((globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1)),
      autoDensity: true,
      roundPixels: true,
      hello: false,
    } as const;
    try {
      await app.init({ ...initOptions, preference: "webgl" });
    } catch {
      this.useCanvasFallback = true;
      await app.init({ ...initOptions, preference: "canvas" });
    }

    this.app = app;
    const canvas = app.canvas;
    host.appendChild(canvas);
    app.stage.addChild(this.world);
    this.mountScene(this.plan);
    this.applyThemePalette(this.theme);
    this.bindVisibilityTicker(app.ticker);
    this.attachContextHandlers(canvas);
    this.themeUnsub = this.shellTheme.onThemeChange((mode) => {
      this.theme = mode;
      this.applyThemePalette(mode);
    });
  }

  destroy(): void {
    this.themeUnsub?.();
    this.themeUnsub = null;
    if (this.frameHook && this.app?.ticker.remove) {
      this.app.ticker.remove(this.frameHook);
    }
    this.app?.destroy(true);
    this.app = null;
  }

  setHostViewportSize(width: number, height: number): void {
    this.camera?.setViewportSize(width, height);
    if (this.app?.renderer) {
      this.app.renderer.resize(width, height);
    }
  }

  setTabActive(active: boolean): void {
    this.visibility.setTabActive(active);
  }

  jumpToRoom(roomId: OfficeRoomId): void {
    this.camera?.jumpToRoom(roomId);
  }

  simulateContextLost(): void {
    this.contextLost = true;
    this.visibility.setTabActive(false);
  }

  simulateContextRestored(): void {
    this.contextLost = false;
    this.visibility.setTabActive(true);
    if (this.plan) {
      void this.atlasEngine.loadFromDisk();
    }
  }

  private layer(id: OfficeLayerId): Container {
    const found = this.layers.get(id);
    if (!found) {
      throw new Error(`missing office layer ${id}`);
    }
    return found;
  }

  private mountScene(plan: LoadedFloorPlan): void {
    for (const id of LAYER_IDS) {
      this.layer(id).removeChildren();
    }
    this.layer("tile").addChild(this.paintTiles(plan));
    this.layer("prop").addChild(this.paintRooms(plan));
    this.layer("character").addChild(this.paintDesks(plan));
    this.layer("badge").addChild(this.paintFrames(BADGE_DEPTHS, 0xffb300));
    this.layer("label").addChild(this.paintFrames(LABEL_DEPTHS, 0xf5f5f5));
  }

  private paintTiles(plan: LoadedFloorPlan): Graphics {
    const graphic = new Graphics();
    let drawn = 0;
    for (let y = 0; y < plan.height; y += 1) {
      for (let x = 0; x < plan.width; x += 1) {
        const gid = plan.walkable[y * plan.width + x] ?? 0;
        if (gid === 0) continue;
        graphic.rect(x * plan.tileSize, y * plan.tileSize, plan.tileSize, plan.tileSize);
        drawn += 1;
      }
    }
    if (drawn === 0) {
      graphic.rect(0, 0, plan.tileSize, plan.tileSize);
    }
    graphic.fill(0xc4a574);
    return graphic;
  }

  private paintRooms(plan: LoadedFloorPlan): Graphics {
    const graphic = new Graphics();
    for (const room of plan.rooms) {
      graphic.rect(room.pixel.x, room.pixel.y, room.pixel.w, room.pixel.h);
    }
    graphic.fill({ color: 0x8d6e63, alpha: 0.35 });
    return graphic;
  }

  private paintDesks(plan: LoadedFloorPlan): Graphics {
    const graphic = new Graphics();
    for (const anchor of plan.deskAnchors) {
      graphic.rect(anchor.pixel.x, anchor.pixel.y, plan.tileSize, plan.tileSize);
    }
    graphic.fill(0x5d4037);
    return graphic;
  }

  private paintFrames(depths: ReadonlySet<SpriteDepthLayer>, color: number): Graphics {
    const graphic = new Graphics();
    let drawn = 0;
    for (const frame of this.atlasEngine.listFrames()) {
      if (!depths.has(frame.depth)) continue;
      graphic.rect(frame.frame.x, frame.frame.y, frame.frame.w, frame.frame.h);
      drawn += 1;
    }
    if (drawn === 0) {
      graphic.rect(0, 0, 16, 16);
    }
    graphic.fill(color);
    return graphic;
  }

  private bindVisibilityTicker(ticker: TickerLike): void {
    this.visibility.bindTicker(ticker);
    this.frameHook = () => {
      this.visibility.onTickerFrame();
    };
    ticker.add?.(this.frameHook);
  }

  private attachContextHandlers(canvas: WebGlCanvas): void {
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault?.();
      this.contextLost = true;
      this.visibility.setTabActive(false);
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
      void this.atlasEngine.loadFromDisk();
      this.visibility.setTabActive(true);
    });
  }

  private applyThemePalette(mode: OfficeThemeMode): void {
    const palette = paletteForTheme(mode);
    this.world.tint = palette.ambient;
    if (this.app?.renderer) {
      this.app.renderer.background.color = palette.ambient;
    }
  }
}
