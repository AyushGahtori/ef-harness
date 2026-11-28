export const POP_OUT_VIEWS = ["preview", "office", "board", "canvas", "inspector"] as const;
export type PopOutView = (typeof POP_OUT_VIEWS)[number];

export const MAX_POP_OUT_WINDOWS = 3;

export const POP_OUT_TITLE: Readonly<Record<PopOutView, string>> = {
  preview: "Live App Preview",
  office: "Office View",
  board: "Board",
  canvas: "Architecture Canvas",
  inspector: "Worker Inspector",
};

export const DOCK_BACK_LABEL = "Dock back into main window";

export type ThemeName = "light" | "dark";

export type ScreenEventName = "display-removed" | "display-metrics-changed";

export type BoundsEvent = "startup" | "display-removed" | "display-metrics-changed";

export type BoundsRecoveryReason =
  | "already-visible"
  | "offscreen-monitor"
  | "insufficient-intersection"
  | "top-bar-clipped"
  | "dpi-reflow";

export interface DipRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ConnectedDisplay {
  readonly id: number;
  readonly bounds: DipRect;
  readonly workArea: DipRect;
  readonly scaleFactor: number;
  readonly primary: boolean;
}

export interface SavedWindowPlacement extends DipRect {
  readonly displayId: number;
}

export interface BoundsRecovery {
  readonly bounds: DipRect;
  readonly displayId: number;
  readonly rescued: boolean;
  readonly centeredOnPrimary: boolean;
  readonly topBarStopVisible: boolean;
  readonly reason: BoundsRecoveryReason;
  readonly widthWithinWorkArea: boolean;
  readonly heightWithinWorkArea: boolean;
  readonly destinationScaleFactor: number;
}

export interface ScreenEventPayload {
  readonly event: ScreenEventName;
  readonly displays: readonly ConnectedDisplay[];
  readonly removedDisplayId?: number;
}

export interface ScreenPort {
  getAllDisplays(): readonly ConnectedDisplay[];
  getPrimaryDisplay(): ConnectedDisplay;
  on(event: ScreenEventName, listener: (payload: ScreenEventPayload) => void): () => void;
}

export interface ManagedWindow {
  readonly id: string;
  theme: ThemeName;
  focusMode: boolean;
  readonly focusCount: number;
  focus(): void;
  close(): void;
  destroy(): void;
  hide(): void;
  show(): void;
  isDestroyed(): boolean;
  isVisible(): boolean;
  getBounds(): DipRect;
  setBounds(bounds: DipRect): void;
  setTheme(theme: ThemeName): void;
  setFocusMode(enabled: boolean): void;
  on(event: "closed", listener: () => void): void;
}

export interface WindowFactory {
  create(options: {
    id: string;
    title: string;
    bounds: DipRect;
    kind: "main" | "popout";
  }): ManagedWindow;
}

export interface HarnessdEvent {
  readonly seq: number;
  readonly type: string;
  readonly projectId: string;
  readonly streamEpoch?: string;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DaemonSnapshot {
  readonly lastSeq: number;
  readonly streamEpoch: string;
  readonly events: readonly HarnessdEvent[];
}

export interface EntitySelectionRoute {
  readonly sourceView: "canvas";
  readonly entityId: string;
  readonly kind: "box" | "task" | "feature" | "worker";
  readonly composerTargetId: string;
  readonly inspectorSelectedId: string;
  readonly focusStolen: false;
  readonly mainWindowFocused: false;
}

export interface MainShellPort {
  redock(view: PopOutView): void;
  undock(view: PopOutView): void;
  routeEntity(route: EntitySelectionRoute): void;
  isBuilding(): boolean;
  notifyTheme(theme: ThemeName): void;
  notifyFocusMode(enabled: boolean): void;
}

export interface TrayLifecyclePort {
  minimizeToTray(reason: "building"): void;
  restoreFromTray(): void;
  isMinimized(): boolean;
}

export interface CenterWorkspaceTabState {
  readonly tabs: readonly PopOutView[];
  readonly active: PopOutView | null;
}

export type PopOutResult =
  | {
      readonly ok: true;
      readonly action: "created" | "focused";
      readonly view: PopOutView;
      readonly windowId: `popout:${PopOutView}`;
      readonly spawned: boolean;
      readonly dockLabel: typeof DOCK_BACK_LABEL;
      readonly title: string;
    }
  | {
      readonly ok: false;
      readonly action: "rejected";
      readonly reason: "popout-cap";
      readonly limit: typeof MAX_POP_OUT_WINDOWS;
      readonly view: PopOutView;
    };

export interface PrimaryCloseResult {
  readonly action: "minimize-to-tray" | "close-popouts";
  readonly popOutsClosed: number;
  readonly popOutsHidden: number;
  readonly building: boolean;
}
