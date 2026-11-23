import { Application, Container } from "pixi.js";

import { paletteForTheme } from "./office-theme-palette.js";
import { OfficeCameraController } from "./office-camera-controller.js";
import { OfficeVisibilityController, type TickerLike } from "./office-visibility-controller.js";
import { CozyPixelSpriteAtlasEngine } from "./cozy-pixel-sprite-atlas-engine.js";
import { TiledFloorPlanLoader } from "./tiled-floor-plan-loader.js";
import type { ShellThemePort } from "./ports.js";
import type { LoadedFloorPlan, OfficeThemeMode } from "./types.js";
import type { OfficeRoomId } from "./room-ids.js";

export const INTEGER_ZOOM_STEPS = [1, 2, 3, 4] as const;
export const PIXEL_SCALE_MODE_NEAREST = "nearest" as const;

export type PixiApplicationLike = Pick<Application, "init" | "destroy" | "renderer" | "stage" | "ticker" | "canvas">;

export type OfficePixiViewportOptions = {
  readonly shellTheme: ShellThemePort;
  readonly width: number;
  readonly height: number;
  readonly floorPlanLoader?: TiledFloorPlanLoader;
  readonly atlasEngine?: CozyPixelSpriteAtlasEngine;
  readonly createApplication?: () => PixiApplicationLike;
};

type WebGlCanvas = {
  addEventListener(type: string, listener: (ev: { preventDefault?: () => void }) => void): void;
};

export type OfficeViewportHost = {
  appendChild(node: unknown): void;
};

export class OfficePixiViewport {
  readonly visibility = new OfficeVisibilityController();
  private readonly shellTheme: ShellThemePort;
  private readonly floorPlanLoader: TiledFloorPlanLoader;
  private readonly atlasEngine: CozyPixelSpriteAtlasEngine;
  private readonly createApplication: () => PixiApplicationLike;
  private app: PixiApplicationLike | null = null;
  private plan: LoadedFloorPlan | null = null;
  private camera: OfficeCameraController | null = null;
  private world = new Container();
  private theme: OfficeThemeMode = "light";
  private themeUnsub: (() => void) | null = null;
  private contextLost = false;
  private useCanvasFallback = false;
  private frameHook: (() => void) | null = null;

  constructor(options: OfficePixiViewportOptions) {
    this.shellTheme = options.shellTheme;
    this.floorPlanLoader = options.floorPlanLoader ?? new TiledFloorPlanLoader();
    this.atlasEngine = options.atlasEngine ?? new CozyPixelSpriteAtlasEngine();
    this.createApplication = options.createApplication ?? (() => new Application() as PixiApplicationLike);
    this.theme = options.shellTheme.readTheme();
  }

  get loadedPlan(): LoadedFloorPlan | null {
    return this.plan;
  }

  get cameraController(): OfficeCameraController | null {
    return this.camera;
  }

  isContextLost(): boolean {
    return this.contextLost;
  }

  usingCanvasFallback(): boolean {
    return this.useCanvasFallback;
  }

  async bootstrap(host: OfficeViewportHost): Promise<void> {
    this.plan = this.floorPlanLoader.loadFromPath();
    this.atlasEngine.loadFromDisk();
    this.camera = new OfficeCameraController({
      viewportWidthPx: 800,
      viewportHeightPx: 600,
      plan: this.plan,
    });

    const app = this.createApplication();
    try {
      await app.init({
        width: 800,
        height: 600,
        antialias: false,
        resolution: Math.max(1, Math.round((globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1)),
        autoDensity: true,
        preference: "webgl",
        roundPixels: true,
        hello: false,
      });
    } catch {
      this.useCanvasFallback = true;
      await app.init({
        width: 800,
        height: 600,
        antialias: false,
        preference: "canvas",
        roundPixels: true,
        hello: false,
      });
    }

    this.app = app;
    const canvas = app.canvas as unknown as WebGlCanvas;
    host.appendChild(canvas);
    app.stage.addChild(this.world);
    this.applyThemePalette(this.theme);
    this.bindVisibilityTicker(app.ticker as TickerLike);
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
      this.atlasEngine.loadFromDisk();
    }
  }

  private bindVisibilityTicker(ticker: TickerLike): void {
    this.visibility.bindTicker(ticker);
    this.frameHook = () => {
      this.visibility.onTickerFrame();
    };
    ticker.add?.(this.frameHook as () => void);
  }

  private attachContextHandlers(canvas: WebGlCanvas): void {
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault?.();
      this.contextLost = true;
      this.visibility.setTabActive(false);
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
      this.atlasEngine.loadFromDisk();
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