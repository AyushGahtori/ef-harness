import type { TrayBadge } from "./types.js";

export interface PreventableEvent {
  preventDefault(): void;
  readonly defaultPrevented: boolean;
}

export interface ElectronAppShape {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  exit(code: number): void;
  setLoginItemSettings(settings: { openAtLogin: boolean; args: string[] }): void;
  getLoginItemSettings(): { openAtLogin: boolean; args?: string[] };
  on(event: string, listener: (...args: unknown[]) => void): void;
}

export interface ElectronPowerMonitorShape {
  on(event: string, listener: () => void): void;
}

export interface ElectronPowerSaveBlockerShape {
  start(type: "prevent-app-suspension"): number;
  stop(id: number): void;
  isStarted(id: number): boolean;
}

export interface ElectronWebContentsShape {
  on(event: string, listener: (...args: unknown[]) => void): void;
  reload(): void;
}

export interface ElectronBrowserWindowShape {
  on(event: string, listener: (...args: unknown[]) => void): void;
  hide(): void;
  show(): void;
  focus(): void;
  destroy(): void;
  isDestroyed(): boolean;
  isVisible(): boolean;
  webContents: ElectronWebContentsShape;
}

export interface ElectronMenuItemShape {
  readonly label: string;
  readonly enabled: boolean;
  readonly type?: "normal" | "separator";
  click?: () => void;
}

export interface ElectronTrayShape {
  setToolTip(tooltip: string): void;
  setImage(image: { readonly badge: TrayBadge }): void;
  setContextMenu(menu: { readonly items: readonly ElectronMenuItemShape[] }): void;
  on(event: "click" | "double-click", listener: () => void): void;
  destroy(): void;
  displayBalloon?(options: { title: string; content: string }): void;
}

export interface ElectronTrayModuleShape {
  create(image: { readonly badge: TrayBadge }): ElectronTrayShape;
}

export interface ElectronNativeImageModuleShape {
  createFromBadge(badge: TrayBadge): { readonly badge: TrayBadge };
}

export interface ElectronModules {
  readonly app: ElectronAppShape;
  readonly powerMonitor: ElectronPowerMonitorShape;
  readonly powerSaveBlocker: ElectronPowerSaveBlockerShape;
  readonly tray: ElectronTrayModuleShape;
  readonly nativeImage: ElectronNativeImageModuleShape;
  readonly window: ElectronBrowserWindowShape | null;
  readonly argv: readonly string[];
}

export const POWER_EVENTS = [
  "suspend",
  "resume",
  "on-ac",
  "on-battery",
  "shutdown",
  "lock-screen",
  "unlock-screen",
] as const;

export type PowerEventName = (typeof POWER_EVENTS)[number];

export interface BoundPowerMonitor {
  on(event: PowerEventName, listener: () => void | Promise<void>): void;
}

export interface BoundQuitApp {
  onBeforeQuit(listener: (event: PreventableEvent) => void): void;
  onWindowAllClosed(listener: (event: PreventableEvent) => void): void;
  onSecondInstance(
    listener: (event: PreventableEvent, argv: readonly string[], workingDirectory: string) => void,
  ): void;
  requestSingleInstanceLock(): boolean;
  quit(): void;
  exit(code: number): void;
  setLoginItemSettings(settings: { openAtLogin: boolean; args: string[] }): void;
  getLoginItemSettings(): { openAtLogin: boolean; args: string[] };
}

export interface BoundElectronHost {
  readonly app: BoundQuitApp;
  readonly powerMonitor: BoundPowerMonitor;
  readonly powerSaveBlocker: ElectronPowerSaveBlockerShape;
  readonly tray: ElectronTrayModuleShape;
  readonly nativeImage: ElectronNativeImageModuleShape;
  readonly window: ElectronBrowserWindowShape | null;
  readonly argv: readonly string[];
}

function asPreventable(value: unknown): PreventableEvent {
  if (
    typeof value === "object" &&
    value !== null &&
    "preventDefault" in value &&
    typeof value.preventDefault === "function"
  ) {
    const candidate = value as { preventDefault: () => void; defaultPrevented?: boolean };
    return {
      preventDefault: () => candidate.preventDefault(),
      get defaultPrevented() {
        return candidate.defaultPrevented === true;
      },
    };
  }
  let prevented = false;
  return {
    preventDefault() {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  };
}

function asArgv(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function bindElectronLifecycleHost(modules: ElectronModules): BoundElectronHost {
  const powerListeners = new Map<string, Array<() => void | Promise<void>>>();
  return {
    argv: modules.argv,
    window: modules.window,
    powerSaveBlocker: modules.powerSaveBlocker,
    tray: modules.tray,
    nativeImage: modules.nativeImage,
    app: {
      requestSingleInstanceLock: () => modules.app.requestSingleInstanceLock(),
      quit: () => modules.app.quit(),
      exit: (code) => modules.app.exit(code),
      setLoginItemSettings: (settings) => modules.app.setLoginItemSettings(settings),
      getLoginItemSettings: () => {
        const current = modules.app.getLoginItemSettings();
        return { openAtLogin: current.openAtLogin === true, args: current.args ?? [] };
      },
      onBeforeQuit: (listener) => {
        modules.app.on("before-quit", (...args) => listener(asPreventable(args[0])));
      },
      onWindowAllClosed: (listener) => {
        modules.app.on("window-all-closed", (...args) => listener(asPreventable(args[0])));
      },
      onSecondInstance: (listener) => {
        modules.app.on("second-instance", (...args) => {
          const workingDirectory = typeof args[2] === "string" ? args[2] : "";
          listener(asPreventable(args[0]), asArgv(args[1]), workingDirectory);
        });
      },
    },
    powerMonitor: {
      on: (event, listener) => {
        const existing = powerListeners.get(event) ?? [];
        existing.push(listener);
        powerListeners.set(event, existing);
        modules.powerMonitor.on(event, () => {
          void listener();
        });
      },
    },
  };
}
