import {
  POP_OUT_VIEWS,
  type ConnectedDisplay,
  type DipRect,
  type EntitySelectionRoute,
  type MainShellPort,
  type ManagedWindow,
  type PopOutView,
  type ScreenEventName,
  type ScreenEventPayload,
  type ScreenPort,
  type ThemeName,
  type TrayLifecyclePort,
  type WindowFactory,
} from "./types.js";

function copyRect(rect: DipRect): DipRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function copyDisplay(display: ConnectedDisplay): ConnectedDisplay {
  return {
    id: display.id,
    bounds: copyRect(display.bounds),
    workArea: copyRect(display.workArea),
    scaleFactor: display.scaleFactor,
    primary: display.primary,
  };
}

/** In-memory stand-in for Electron `screen` from the Task 067 bootstrap. */
export class InMemoryScreenPort implements ScreenPort {
  private displays: ConnectedDisplay[];
  private readonly listeners: Record<ScreenEventName, Set<(payload: ScreenEventPayload) => void>> = {
    "display-removed": new Set(),
    "display-metrics-changed": new Set(),
  };

  constructor(displays: readonly ConnectedDisplay[]) {
    this.displays = displays.map(copyDisplay);
    this.assertPrimary();
  }

  getAllDisplays(): readonly ConnectedDisplay[] {
    return this.displays.map(copyDisplay);
  }

  getPrimaryDisplay(): ConnectedDisplay {
    const primary = this.displays.find((display) => display.primary);
    if (!primary) {
      throw new Error("No primary display is connected");
    }
    return copyDisplay(primary);
  }

  on(event: ScreenEventName, listener: (payload: ScreenEventPayload) => void): () => void {
    this.listeners[event].add(listener);
    return () => {
      this.listeners[event].delete(listener);
    };
  }

  replaceDisplays(
    next: readonly ConnectedDisplay[],
    event: ScreenEventName,
    removedDisplayId?: number,
  ): void {
    this.displays = next.map(copyDisplay);
    this.assertPrimary();
    const payload: ScreenEventPayload =
      removedDisplayId === undefined
        ? { event, displays: this.getAllDisplays() }
        : { event, displays: this.getAllDisplays(), removedDisplayId };
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }

  private assertPrimary(): void {
    if (!this.displays.some((display) => display.primary)) {
      throw new Error("No primary display is connected");
    }
  }
}

export class InMemoryWindow implements ManagedWindow {
  theme: ThemeName = "light";
  focusMode = false;
  focusCount = 0;
  private destroyed = false;
  private visible = true;
  private bounds: DipRect;
  private readonly closedHandlers: Array<() => void> = [];

  constructor(
    readonly id: string,
    readonly title: string,
    bounds: DipRect,
    readonly kind: "main" | "popout",
  ) {
    this.bounds = copyRect(bounds);
  }

  focus(): void {
    this.focusCount += 1;
  }

  close(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    for (const listener of [...this.closedHandlers]) {
      listener();
    }
  }

  destroy(): void {
    this.close();
  }

  hide(): void {
    if (!this.destroyed) this.visible = false;
  }

  show(): void {
    if (!this.destroyed) this.visible = true;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isVisible(): boolean {
    return this.visible && !this.destroyed;
  }

  getBounds(): DipRect {
    return copyRect(this.bounds);
  }

  setBounds(bounds: DipRect): void {
    this.bounds = copyRect(bounds);
  }

  setTheme(theme: ThemeName): void {
    this.theme = theme;
  }

  setFocusMode(enabled: boolean): void {
    this.focusMode = enabled;
  }

  on(event: "closed", listener: () => void): void {
    if (event === "closed") this.closedHandlers.push(listener);
  }
}

/** In-memory stand-in for Electron `BrowserWindow`. */
export class InMemoryWindowFactory implements WindowFactory {
  readonly created: InMemoryWindow[] = [];

  create(options: {
    id: string;
    title: string;
    bounds: DipRect;
    kind: "main" | "popout";
  }): ManagedWindow {
    const window = new InMemoryWindow(options.id, options.title, options.bounds, options.kind);
    this.created.push(window);
    return window;
  }
}

/** In-memory stand-in for the Task 122 shell tab strip and inspector route. */
export class InMemoryMainShell implements MainShellPort {
  building = false;
  theme: ThemeName = "light";
  focusMode = false;
  readonly docked = new Set<PopOutView>(POP_OUT_VIEWS);
  active: PopOutView | null = null;
  lastRoute: EntitySelectionRoute | null = null;

  redock(view: PopOutView): void {
    this.docked.add(view);
    this.active = view;
  }

  undock(view: PopOutView): void {
    this.docked.delete(view);
    if (this.active === view) this.active = null;
  }

  routeEntity(route: EntitySelectionRoute): void {
    this.lastRoute = route;
  }

  isBuilding(): boolean {
    return this.building;
  }

  notifyTheme(theme: ThemeName): void {
    this.theme = theme;
  }

  notifyFocusMode(enabled: boolean): void {
    this.focusMode = enabled;
  }
}

/** In-memory stand-in for Task 131 tray minimize while a build is running. */
export class InMemoryTrayLifecycle implements TrayLifecyclePort {
  private minimized = false;
  lastReason: "building" | null = null;

  minimizeToTray(reason: "building"): void {
    this.minimized = true;
    this.lastReason = reason;
  }

  restoreFromTray(): void {
    this.minimized = false;
  }

  isMinimized(): boolean {
    return this.minimized;
  }
}
