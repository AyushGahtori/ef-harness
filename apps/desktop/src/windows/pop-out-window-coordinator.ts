import { DisconnectedMonitorBoundsGuard } from "./disconnected-monitor-bounds-guard.js";
import type { SharedHarnessdStream } from "./shared-harnessd-stream.js";
import {
  DOCK_BACK_LABEL,
  MAX_POP_OUT_WINDOWS,
  POP_OUT_TITLE,
  POP_OUT_VIEWS,
  type BoundsRecovery,
  type CenterWorkspaceTabState,
  type DaemonSnapshot,
  type EntitySelectionRoute,
  type MainShellPort,
  type ManagedWindow,
  type PopOutResult,
  type PopOutView,
  type PrimaryCloseResult,
  type SavedWindowPlacement,
  type ScreenPort,
  type ThemeName,
  type TrayLifecyclePort,
  type WindowFactory,
} from "./types.js";

interface PopOutRecord {
  readonly view: PopOutView;
  readonly window: ManagedWindow;
  readonly unsubscribe: () => void;
  settled: boolean;
  lastSharedSeq: number;
}

export interface PopOutCoordinatorOptions {
  readonly screen: ScreenPort;
  readonly factory: WindowFactory;
  readonly stream: SharedHarnessdStream;
  readonly shell: MainShellPort;
  readonly tray: TrayLifecyclePort;
  readonly main: ManagedWindow;
  readonly guard?: DisconnectedMonitorBoundsGuard;
}

/**
 * Secondary native windows for heavy reference views. Every window reads the
 * same harnessd stream. Closing a pop-out puts its tab back on the main shell.
 */
export class PopOutWindowCoordinator {
  private readonly screen: ScreenPort;
  private readonly factory: WindowFactory;
  private readonly stream: SharedHarnessdStream;
  private readonly shell: MainShellPort;
  private readonly tray: TrayLifecyclePort;
  private readonly main: ManagedWindow;
  private readonly guard: DisconnectedMonitorBoundsGuard;
  private readonly popouts = new Map<PopOutView, PopOutRecord>();
  private readonly displayIds = new Map<string, number>();
  private readonly docked = new Set<PopOutView>(POP_OUT_VIEWS);
  private readonly stopScreen: Array<() => void> = [];
  private activeDocked: PopOutView | null = null;
  private theme: ThemeName = "light";
  private focusMode = false;
  private shuttingDown = false;
  private sharedSeq = 0;
  private mainUnsubscribe: () => void;

  constructor(options: PopOutCoordinatorOptions) {
    this.screen = options.screen;
    this.factory = options.factory;
    this.stream = options.stream;
    this.shell = options.shell;
    this.tray = options.tray;
    this.main = options.main;
    this.guard = options.guard ?? new DisconnectedMonitorBoundsGuard(options.screen);
    this.displayIds.set(options.main.id, options.screen.getPrimaryDisplay().id);
    this.mainUnsubscribe = this.stream.subscribe((event) => {
      this.sharedSeq = event.seq;
    });
    this.stopScreen.push(
      this.screen.on("display-removed", () => {
        this.migrateAll("display-removed");
      }),
      this.screen.on("display-metrics-changed", () => {
        this.migrateAll("display-metrics-changed");
      }),
    );
  }

  popOut(view: PopOutView, saved?: SavedWindowPlacement): PopOutResult {
    const existing = this.popouts.get(view);
    if (existing && !existing.window.isDestroyed()) {
      existing.window.focus();
      return this.opened(view, "focused", false);
    }
    if (this.popouts.size >= MAX_POP_OUT_WINDOWS) {
      return {
        ok: false,
        action: "rejected",
        reason: "popout-cap",
        limit: MAX_POP_OUT_WINDOWS,
        view,
      };
    }
    const placement = saved ?? this.defaultPlacement(view);
    const recovery = this.guard.recover(placement, "startup");
    const window = this.factory.create({
      id: popOutWindowId(view),
      title: POP_OUT_TITLE[view],
      bounds: recovery.bounds,
      kind: "popout",
    });
    window.setTheme(this.theme);
    window.setFocusMode(this.focusMode);
    let stopListening: (() => void) | null = null;
    const record: PopOutRecord = {
      view,
      window,
      settled: false,
      lastSharedSeq: this.stream.snapshot().lastSeq,
      unsubscribe: () => {
        stopListening?.();
      },
    };
    stopListening = this.stream.subscribe((event) => {
      record.lastSharedSeq = event.seq;
    });
    window.on("closed", () => {
      this.finishClose(view);
    });
    this.popouts.set(view, record);
    this.displayIds.set(window.id, recovery.displayId);
    this.docked.delete(view);
    if (this.activeDocked === view) this.activeDocked = null;
    this.shell.undock(view);
    return this.opened(view, "created", true);
  }

  dockBack(view: PopOutView): void {
    const record = this.popouts.get(view);
    if (!record || record.window.isDestroyed()) return;
    record.window.close();
  }

  windowFor(view: PopOutView): ManagedWindow | null {
    return this.popouts.get(view)?.window ?? null;
  }

  isPoppedOut(view: PopOutView): boolean {
    const record = this.popouts.get(view);
    return record !== undefined && !record.window.isDestroyed();
  }

  centerWorkspaceTabs(): CenterWorkspaceTabState {
    return {
      tabs: POP_OUT_VIEWS.filter((view) => this.docked.has(view)),
      active: this.activeDocked,
    };
  }

  daemonSnapshot(): DaemonSnapshot {
    return this.stream.snapshot();
  }

  /** Cursor into the shared stream. Pop-outs do not keep their own event log. */
  sharedEventSeq(): number {
    return this.sharedSeq;
  }

  observedSeq(view: PopOutView): number | null {
    return this.popouts.get(view)?.lastSharedSeq ?? null;
  }

  subscriberCount(): number {
    return this.stream.subscriberCount();
  }

  setTheme(theme: ThemeName): void {
    this.theme = theme;
    this.main.setTheme(theme);
    for (const record of this.popouts.values()) {
      record.window.setTheme(theme);
    }
    this.shell.notifyTheme(theme);
  }

  setFocusMode(enabled: boolean): void {
    this.focusMode = enabled;
    this.main.setFocusMode(enabled);
    for (const record of this.popouts.values()) {
      record.window.setFocusMode(enabled);
    }
    this.shell.notifyFocusMode(enabled);
  }

  routeCanvasEntity(entity: {
    entityId: string;
    kind: EntitySelectionRoute["kind"];
  }): EntitySelectionRoute {
    const route: EntitySelectionRoute = {
      sourceView: "canvas",
      entityId: entity.entityId,
      kind: entity.kind,
      composerTargetId: entity.entityId,
      inspectorSelectedId: entity.entityId,
      focusStolen: false,
      mainWindowFocused: false,
    };
    this.shell.routeEntity(route);
    return route;
  }

  restore(window: ManagedWindow, saved: SavedWindowPlacement): BoundsRecovery {
    const recovery = this.guard.recover(saved, "startup");
    window.setBounds(recovery.bounds);
    this.displayIds.set(window.id, recovery.displayId);
    return recovery;
  }

  onPrimaryWindowClose(): PrimaryCloseResult {
    const building = this.shell.isBuilding();
    if (building) {
      this.tray.minimizeToTray("building");
      this.main.hide();
      return {
        action: "minimize-to-tray",
        popOutsClosed: 0,
        popOutsHidden: 0,
        building: true,
      };
    }
    const closing = this.popouts.size;
    this.shuttingDown = true;
    for (const record of [...this.popouts.values()]) {
      record.window.close();
    }
    return {
      action: "close-popouts",
      popOutsClosed: closing,
      popOutsHidden: 0,
      building: false,
    };
  }

  restoreFromTray(): void {
    if (!this.tray.isMinimized()) return;
    this.tray.restoreFromTray();
    this.main.show();
    for (const record of this.popouts.values()) {
      record.window.show();
    }
  }

  dispose(): void {
    this.mainUnsubscribe();
    for (const stop of this.stopScreen) stop();
    this.stopScreen.length = 0;
  }

  private opened(view: PopOutView, action: "created" | "focused", spawned: boolean): PopOutResult {
    return {
      ok: true,
      action,
      view,
      windowId: popOutWindowId(view),
      spawned,
      dockLabel: DOCK_BACK_LABEL,
      title: POP_OUT_TITLE[view],
    };
  }

  private finishClose(view: PopOutView): void {
    const record = this.popouts.get(view);
    if (!record || record.settled) return;
    record.settled = true;
    this.popouts.delete(view);
    record.unsubscribe();
    this.displayIds.delete(record.window.id);
    if (this.shuttingDown) return;
    this.docked.add(view);
    this.activeDocked = view;
    this.shell.redock(view);
  }

  private migrateAll(event: "display-removed" | "display-metrics-changed"): void {
    this.migrateWindow(this.main, event);
    for (const record of this.popouts.values()) {
      if (!record.window.isDestroyed()) this.migrateWindow(record.window, event);
    }
  }

  private migrateWindow(window: ManagedWindow, event: "display-removed" | "display-metrics-changed"): void {
    const bounds = window.getBounds();
    const displayId = this.displayIds.get(window.id) ?? this.screen.getPrimaryDisplay().id;
    const recovery = this.guard.recover({ ...bounds, displayId }, event);
    window.setBounds(recovery.bounds);
    this.displayIds.set(window.id, recovery.displayId);
  }

  private defaultPlacement(view: PopOutView): SavedWindowPlacement {
    const primary = this.screen.getPrimaryDisplay();
    const stagger = POP_OUT_VIEWS.indexOf(view) * 24;
    return {
      x: primary.workArea.x + 80 + stagger,
      y: primary.workArea.y + 80 + stagger,
      width: Math.min(1100, primary.workArea.width),
      height: Math.min(720, primary.workArea.height),
      displayId: primary.id,
    };
  }
}

export function popOutWindowId(view: PopOutView): `popout:${PopOutView}` {
  return `popout:${view}`;
}
