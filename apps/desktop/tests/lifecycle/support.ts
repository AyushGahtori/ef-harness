import {
  DesktopLifecycleCoordinator,
  HEALTHY_ENVIRONMENT,
  LocalClaimGate,
  LocalColdOpenReconciler,
  LocalHardwareGovernor,
  LocalRetryLedger,
  LocalSleepSkewGuard,
  LocalStuckClockGuard,
  MemoryPreferenceStore,
  RecordingCheckpoints,
  RecordingDaemonClient,
  RecordingDaemonPresence,
  RecordingEventStream,
  RecordingJobObjects,
  RecordingKernelStop,
  RecordingPopOuts,
  RecordingSqlite,
  RecordingWindowHost,
  ScriptedEnvironmentProbe,
  idleActivity,
  type BuildActivity,
  type DesktopLifecycleDependencies,
  type LoginItemSettingsHost,
  type PowerSaveBlockerLike,
  type SingleInstanceApp,
  type TrayFactory,
  type TrayHandle,
  type TrayImage,
  type TrayMenuSpec,
  type TrayNotification,
} from "../../src/lifecycle/index.js";

export { idleActivity };

export class ManualClock {
  value: number;

  constructor(start = 1_000_000) {
    this.value = start;
  }

  now(): number {
    return this.value;
  }

  advance(ms: number): void {
    this.value += ms;
  }
}

export class MemoryTray implements TrayHandle {
  tooltip = "";
  image: TrayImage | null = null;
  menu: TrayMenuSpec | null = null;
  destroyed = false;
  private readonly listeners = new Map<string, Array<() => void>>();

  setToolTip(tooltip: string): void {
    this.tooltip = tooltip;
  }

  setImage(image: TrayImage): void {
    this.image = image;
  }

  setContextMenu(menu: TrayMenuSpec): void {
    this.menu = menu;
  }

  on(event: "click" | "double-click", listener: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  emit(event: "click" | "double-click"): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  destroy(): void {
    this.destroyed = true;
  }

  select(id: string): void {
    this.menu?.items.find((item) => item.id === id)?.onSelect();
  }
}

export class MemoryTrayFactory implements TrayFactory {
  readonly trays: MemoryTray[] = [];

  createImage(badge: TrayImage["badge"]): TrayImage {
    return { badge, width: 16, height: 16 };
  }

  createTray(image: TrayImage): TrayHandle {
    const tray = new MemoryTray();
    tray.setImage(image);
    this.trays.push(tray);
    return tray;
  }
}

export class MemoryNotifier {
  readonly shown: TrayNotification[] = [];

  show(notification: TrayNotification): void {
    this.shown.push(notification);
  }
}

export class MemoryPowerSaveBlocker implements PowerSaveBlockerLike {
  private nextId = 1;
  private readonly active = new Set<number>();
  readonly starts: string[] = [];
  readonly stops: number[] = [];

  start(type: "prevent-app-suspension"): number {
    this.starts.push(type);
    const id = this.nextId;
    this.nextId += 1;
    this.active.add(id);
    return id;
  }

  stop(id: number): void {
    this.stops.push(id);
    this.active.delete(id);
  }

  isStarted(id: number): boolean {
    return this.active.has(id);
  }
}

export class MemoryLoginItems implements LoginItemSettingsHost {
  openAtLogin = false;
  args: string[] = [];
  sets = 0;

  getLoginItemSettings(): { openAtLogin: boolean; args: string[] } {
    return { openAtLogin: this.openAtLogin, args: this.args };
  }

  setLoginItemSettings(settings: { openAtLogin: boolean; args: string[] }): void {
    this.sets += 1;
    this.openAtLogin = settings.openAtLogin;
    this.args = [...settings.args];
  }
}

export class BrokerApp implements SingleInstanceApp {
  exited: number | null = null;
  private listener: ((argv: readonly string[], workingDirectory: string) => void) | null = null;

  constructor(
    private readonly broker: SingleInstanceBroker,
    readonly argv: readonly string[],
  ) {}

  requestSingleInstanceLock(): boolean {
    return this.broker.tryLock(this);
  }

  onSecondInstance(listener: (argv: readonly string[], workingDirectory: string) => void): void {
    this.listener = listener;
    this.broker.listen(this, listener);
  }

  emitSecond(argv: readonly string[], workingDirectory: string): void {
    this.listener?.(argv, workingDirectory);
  }

  exit(code: number): void {
    this.exited = code;
  }
}

export class SingleInstanceBroker {
  primary: BrokerApp | null = null;
  private listener: ((argv: readonly string[], workingDirectory: string) => void) | null = null;

  create(argv: readonly string[]): BrokerApp {
    return new BrokerApp(this, argv);
  }

  tryLock(app: BrokerApp): boolean {
    if (!this.primary) {
      this.primary = app;
      return true;
    }
    this.listener?.(app.argv, "C:\\src");
    return false;
  }

  listen(app: BrokerApp, listener: (argv: readonly string[], workingDirectory: string) => void): void {
    if (app === this.primary) this.listener = listener;
  }
}

export function building(overrides: Partial<BuildActivity> = {}): BuildActivity {
  return idleActivity({
    state: "BUILDING",
    projectName: "Kitchen App",
    activeWorkers: 3,
    ...overrides,
  });
}

export interface LifecycleHarness {
  readonly clock: ManualClock;
  readonly coordinator: DesktopLifecycleCoordinator;
  readonly daemon: RecordingDaemonClient;
  readonly stop: RecordingKernelStop;
  readonly popOuts: RecordingPopOuts;
  readonly windows: RecordingWindowHost;
  readonly clocks: LocalStuckClockGuard;
  readonly leases: LocalSleepSkewGuard;
  readonly coldOpen: LocalColdOpenReconciler;
  readonly governor: LocalHardwareGovernor;
  readonly probe: ScriptedEnvironmentProbe;
  readonly claims: LocalClaimGate;
  readonly checkpoints: RecordingCheckpoints;
  readonly jobs: RecordingJobObjects;
  readonly sqlite: RecordingSqlite;
  readonly retries: LocalRetryLedger;
  readonly stream: RecordingEventStream;
  readonly presence: RecordingDaemonPresence;
  readonly preferences: MemoryPreferenceStore;
  readonly trayFactory: MemoryTrayFactory;
  readonly notifier: MemoryNotifier;
  readonly blocker: MemoryPowerSaveBlocker;
  readonly login: MemoryLoginItems;
  readonly singleInstanceApp: SingleInstanceApp;
  readonly battery: { percent: number | null };
}

export function createHarness(
  activity: BuildActivity = idleActivity(),
  overrides: Partial<DesktopLifecycleDependencies> = {},
): LifecycleHarness {
  const clock = new ManualClock();
  const daemon = new RecordingDaemonClient();
  const stop = new RecordingKernelStop();
  const popOuts = new RecordingPopOuts();
  const windows = new RecordingWindowHost();
  const clocks = new LocalStuckClockGuard();
  const leases = new LocalSleepSkewGuard();
  const coldOpen = new LocalColdOpenReconciler();
  const governor = new LocalHardwareGovernor();
  const probe = new ScriptedEnvironmentProbe(HEALTHY_ENVIRONMENT);
  const claims = new LocalClaimGate();
  const checkpoints = new RecordingCheckpoints();
  const jobs = new RecordingJobObjects();
  const sqlite = new RecordingSqlite();
  const retries = new LocalRetryLedger();
  const stream = new RecordingEventStream();
  const presence = new RecordingDaemonPresence();
  const preferences = new MemoryPreferenceStore();
  const trayFactory = new MemoryTrayFactory();
  const notifier = new MemoryNotifier();
  const blocker = new MemoryPowerSaveBlocker();
  const login = new MemoryLoginItems();
  const broker = new SingleInstanceBroker();
  const singleInstanceApp = overrides.singleInstanceApp ?? broker.create(["ef-harness.exe"]);
  const battery = { percent: activity.batteryPercent };
  const coordinator = new DesktopLifecycleCoordinator({
    now: () => clock.now(),
    daemon,
    stop,
    popOuts,
    windows,
    clocks,
    leases,
    reconciler: coldOpen,
    governor,
    probe,
    claims,
    checkpoints,
    jobs,
    sqlite,
    retries,
    stream,
    daemonPresence: presence,
    preferences,
    trayFactory,
    notifier,
    powerSaveBlocker: blocker,
    loginItems: login,
    singleInstanceApp,
    readBattery: () => battery.percent,
    activity,
    ...overrides,
  });
  return {
    clock,
    coordinator,
    daemon,
    stop,
    popOuts,
    windows,
    clocks,
    leases,
    coldOpen,
    governor,
    probe,
    claims,
    checkpoints,
    jobs,
    sqlite,
    retries,
    stream,
    presence,
    preferences,
    trayFactory,
    notifier,
    blocker,
    login,
    singleInstanceApp,
    battery,
  };
}
