import type { BoundElectronHost, ElectronBrowserWindowShape } from "./electron-binding.js";
import { POWER_EVENTS, type PowerEventName } from "./electron-binding.js";
import type {
  CheckpointFlushPort,
  ClaimGatePort,
  ColdOpenReconcilerPort,
  DaemonLifecycleClient,
  DaemonPresence,
  EnvironmentProbe,
  EventStreamReconnectPort,
  HardwareGovernorPort,
  ImmediateKernelStopPort,
  PopOutWindowPort,
  PreferenceStore,
  RetryLedgerPort,
  SleepSkewGuardPort,
  SqliteCheckpointPort,
  StuckClockPort,
  WindowHost,
  WindowsJobObjectPort,
} from "./ports.js";
import type { PowerSaveBlockerLike } from "./optional-power-save-blocker.js";
import { OptionalPowerSaveBlocker } from "./optional-power-save-blocker.js";
import { PowerMonitorSleepReconciler } from "./power-monitor-sleep-reconciler.js";
import {
  QuitWhileBuildingDialog,
  type IdleQuitResolution,
  type QuitIntercept,
  type QuitResolution,
} from "./quit-while-building-dialog.js";
import { RendererCrashRecovery } from "./renderer-crash-recovery.js";
import { SingleInstanceLock, type SingleInstanceAcquisition, type SingleInstanceApp } from "./single-instance-lock.js";
import { StartAtSignInManager, type LoginItemSettingsHost } from "./start-at-sign-in-manager.js";
import { SystemTrayController, type DesktopNotifier, type TrayFactory } from "./system-tray-controller.js";
import {
  hasActiveExecution,
  idleActivity,
  type BuildActivity,
  type ClosePrompt,
  type QuitChoiceId,
  type QuitPrompt,
  type QuitSource,
} from "./types.js";
import { WindowClosePolicy } from "./window-close-policy.js";

export const KEEP_IN_TRAY_LABEL = "Keep in tray";

export interface DesktopLifecycleDependencies {
  readonly now: () => number;
  readonly daemon: DaemonLifecycleClient;
  readonly stop: ImmediateKernelStopPort;
  readonly popOuts: PopOutWindowPort;
  readonly windows: WindowHost;
  readonly clocks: StuckClockPort;
  readonly leases: SleepSkewGuardPort;
  readonly reconciler: ColdOpenReconcilerPort;
  readonly governor: HardwareGovernorPort;
  readonly probe: EnvironmentProbe;
  readonly claims: ClaimGatePort;
  readonly checkpoints: CheckpointFlushPort;
  readonly jobs: WindowsJobObjectPort;
  readonly sqlite: SqliteCheckpointPort;
  readonly retries: RetryLedgerPort;
  readonly stream: EventStreamReconnectPort;
  readonly daemonPresence: DaemonPresence;
  readonly preferences: PreferenceStore;
  readonly trayFactory: TrayFactory;
  readonly notifier: DesktopNotifier;
  readonly powerSaveBlocker: PowerSaveBlockerLike;
  readonly loginItems: LoginItemSettingsHost;
  readonly singleInstanceApp: SingleInstanceApp;
  readonly readBattery: () => number | null;
  activity?: BuildActivity;
}

export type QuitRequestResult =
  | { readonly kind: "idle"; readonly result: IdleQuitResolution }
  | { readonly kind: "dialog"; readonly prompt: QuitPrompt }
  | { readonly kind: "already-quitting" };

export type WindowCloseResult =
  | { readonly kind: "minimized"; readonly prompted: false }
  | { readonly kind: "prompt"; readonly prompt: ClosePrompt }
  | { readonly kind: "stay-open" }
  | QuitRequestResult;

function crashDetails(value: unknown): { reason: string } {
  if (typeof value === "object" && value !== null && "reason" in value && typeof value.reason === "string") {
    return { reason: value.reason };
  }
  return { reason: "unknown" };
}

export class DesktopLifecycleCoordinator {
  readonly tray: SystemTrayController;
  readonly dialog: QuitWhileBuildingDialog;
  readonly power: PowerMonitorSleepReconciler;
  readonly blocker: OptionalPowerSaveBlocker;
  readonly signIn: StartAtSignInManager;
  readonly singleInstance: SingleInstanceLock;
  readonly recovery: RendererCrashRecovery;
  readonly closePolicy: WindowClosePolicy;
  private activity: BuildActivity;
  private keepInTray = false;
  private resident = false;
  private allowQuit = false;
  private quitBusy = false;
  private closePrompt: ClosePrompt | null = null;
  private quitPrompt: QuitPrompt | null = null;
  private electronQuits = 0;
  private boundQuit: () => void = () => undefined;

  constructor(private readonly deps: DesktopLifecycleDependencies) {
    this.activity = deps.activity ?? idleActivity();
    this.blocker = new OptionalPowerSaveBlocker(deps.powerSaveBlocker);
    this.signIn = new StartAtSignInManager(deps.loginItems);
    this.closePolicy = new WindowClosePolicy(deps.preferences);
    this.tray = new SystemTrayController(
      deps.trayFactory,
      {
        open: () => this.restoreFromTray(),
        pause: () => {
          void this.pauseFromTray();
        },
        stop: () => {
          void this.stopFromTray();
        },
        quit: () => {
          void this.requestQuit("tray");
        },
        restore: () => this.restoreFromTray(),
      },
      deps.notifier,
    );
    this.power = new PowerMonitorSleepReconciler({
      now: deps.now,
      daemon: deps.daemon,
      clocks: deps.clocks,
      leases: deps.leases,
      reconciler: deps.reconciler,
      governor: deps.governor,
      probe: deps.probe,
      claims: deps.claims,
      checkpoints: deps.checkpoints,
      jobs: deps.jobs,
      sqlite: deps.sqlite,
      retries: deps.retries,
      ecoOnBattery: false,
    });
    this.recovery = new RendererCrashRecovery({
      daemon: deps.daemonPresence,
      stream: deps.stream,
      now: deps.now,
      reloadWindow: () => {
        this.resident = false;
        deps.windows.showMain();
      },
    });
    this.singleInstance = new SingleInstanceLock(deps.singleInstanceApp, () => {
      const forwarded = this.singleInstance.lastForwardedLaunch();
      if (forwarded) this.deps.windows.deliverLaunch(forwarded);
      this.restoreFromTray();
    });
    this.dialog = new QuitWhileBuildingDialog({
      getActivity: () => this.activity,
      now: deps.now,
      daemon: deps.daemon,
      stop: deps.stop,
      popOuts: deps.popOuts,
      windows: deps.windows,
      tray: this.tray,
      requestElectronQuit: () => this.finishElectronQuit(),
      onPrompt: (prompt) => {
        this.quitPrompt = prompt;
      },
    });
    this.refreshChrome();
  }

  currentActivity(): BuildActivity {
    return this.activity;
  }

  isResident(): boolean {
    return this.resident;
  }

  currentQuitPrompt(): QuitPrompt | null {
    return this.quitPrompt;
  }

  currentClosePrompt(): ClosePrompt | null {
    return this.closePrompt;
  }

  setActivity(next: BuildActivity): void {
    const previous = this.activity;
    this.activity = next;
    this.refreshChrome();
    if (!this.resident) return;
    if (previous.state === "BUILDING" && next.state === "DONE") {
      const wave = next.waveLabel ?? "Build";
      this.tray.notify({
        title: "EF Harness",
        body: `${wave} finished`,
        onClick: () => this.restoreFromTray(),
      });
    }
    if (next.priorityCard === "P0" && previous.priorityCard !== "P0") {
      this.tray.notify({
        title: "EF Harness",
        body: "P0 card needs you",
        onClick: () => this.restoreFromTray(),
      });
    }
    if (next.questionsNeedingYou > previous.questionsNeedingYou) {
      this.tray.notify({
        title: "EF Harness",
        body: next.questionsNeedingYou === 1 ? "1 question needs you" : `${next.questionsNeedingYou} questions need you`,
        onClick: () => this.restoreFromTray(),
      });
    }
  }

  setKeepInTray(enabled: boolean): void {
    this.keepInTray = enabled;
    this.refreshChrome();
  }

  setPreventSleepDuringActiveBuild(enabled: boolean): void {
    this.blocker.setOptIn(enabled);
    this.blocker.sync({ state: this.activity.state, batteryPercent: this.activity.batteryPercent });
  }

  setEcoOnBattery(enabled: boolean): void {
    this.power.setEcoOnBattery(enabled);
  }

  setStartAtSignIn(enabled: boolean): void {
    this.signIn.setEnabled(enabled);
  }

  async requestQuit(source: QuitSource): Promise<QuitRequestResult> {
    if (this.allowQuit) return { kind: "already-quitting" };
    const decision: QuitIntercept = this.dialog.intercept(source);
    if (decision.kind === "immediate") {
      if (this.quitBusy) return { kind: "already-quitting" };
      this.quitBusy = true;
      try {
        const result = await this.dialog.completeImmediateQuit();
        this.resident = false;
        this.quitPrompt = null;
        return { kind: "idle", result };
      } finally {
        this.quitBusy = false;
      }
    }
    this.quitPrompt = decision.prompt;
    return { kind: "dialog", prompt: decision.prompt };
  }

  async resolveQuit(choice: QuitChoiceId): Promise<QuitResolution> {
    const result = await this.dialog.choose(choice);
    this.quitPrompt = null;
    if (result.choice === "keep-building-in-background") {
      this.resident = true;
      this.refreshChrome();
    }
    if (result.choice === "cancel") {
      this.resident = false;
      this.refreshChrome();
    }
    return result;
  }

  async handleWindowClose(): Promise<WindowCloseResult> {
    const decision = this.closePolicy.decide({ buildActive: hasActiveExecution(this.activity) });
    if (decision.kind === "quit-idle") {
      this.closePrompt = null;
      return this.requestQuit("window-x");
    }
    if (decision.kind === "minimize") {
      this.enterTray();
      return { kind: "minimized", prompted: false };
    }
    this.closePrompt = decision.prompt;
    return { kind: "prompt", prompt: decision.prompt };
  }

  confirmMinimize(remember: boolean): void {
    this.closePolicy.confirm(remember);
    this.closePrompt = null;
    this.enterTray();
  }

  dismissMinimize(): void {
    this.closePolicy.stayOpen();
    this.closePrompt = null;
  }

  restoreFromTray(): void {
    this.resident = false;
    this.deps.windows.showMain();
    this.deps.windows.focusMain();
    void this.deps.stream.resync({ reason: "tray-restore" });
    this.refreshChrome();
  }

  acquireSingleInstance(argv: readonly string[]): SingleInstanceAcquisition {
    const acquisition = this.singleInstance.acquire(argv);
    if (acquisition.shouldExit) {
      this.deps.singleInstanceApp.exit(0);
      return acquisition;
    }
    if (acquisition.forwarded?.hiddenTray) {
      this.resident = true;
      this.deps.windows.hideMain();
      this.refreshChrome();
    }
    if (acquisition.forwarded && (acquisition.forwarded.projectPath || acquisition.forwarded.deepLink)) {
      this.deps.windows.deliverLaunch({
        projectPath: acquisition.forwarded.projectPath,
        deepLink: acquisition.forwarded.deepLink,
        hiddenTray: acquisition.forwarded.hiddenTray,
        workingDirectory: "",
      });
    }
    return acquisition;
  }

  attach(host: BoundElectronHost): SingleInstanceAcquisition {
    this.boundQuit = () => host.app.quit();
    host.app.onBeforeQuit((event) => {
      if (this.allowQuit) return;
      event.preventDefault();
      void this.requestQuit("before-quit");
    });
    host.app.onWindowAllClosed((event) => {
      if (this.resident || this.keepInTray || hasActiveExecution(this.activity)) {
        event.preventDefault();
      }
    });
    for (const event of POWER_EVENTS) {
      host.powerMonitor.on(event, () => this.dispatchPower(event));
    }
    this.attachWindow(host.window);
    return this.acquireSingleInstance(host.argv);
  }

  async dispatchPower(event: PowerEventName): Promise<void> {
    if (event === "suspend") {
      await this.power.onSuspend();
      return;
    }
    if (event === "resume") {
      await this.power.onResume();
      return;
    }
    if (event === "on-battery") {
      const batteryPercent = this.deps.readBattery();
      this.activity = { ...this.activity, batteryPercent };
      this.blocker.sync({ state: this.activity.state, batteryPercent });
      await this.power.onBattery(batteryPercent);
      this.refreshChrome();
      return;
    }
    if (event === "on-ac") {
      this.blocker.sync({ state: this.activity.state, batteryPercent: null });
      await this.power.onAc();
      return;
    }
    if (event === "shutdown") {
      await this.power.onShutdown();
      this.finishElectronQuit();
      return;
    }
    if (event === "lock-screen") {
      await this.power.onLock();
      return;
    }
    await this.power.onUnlock();
  }

  private async pauseFromTray(): Promise<void> {
    await this.deps.stop.pauseSafely({ reason: "tray-pause", graceMs: 15_000 });
    this.setActivity({ ...this.activity, state: "PAUSED", activeWorkers: 0 });
  }

  private async stopFromTray(): Promise<void> {
    await this.deps.stop.stopNow({ reason: "tray-stop" });
    this.setActivity({
      ...this.activity,
      state: "STOPPED",
      activeWorkers: 0,
      verificationActive: false,
      mergeQueueActive: false,
    });
  }

  private enterTray(): void {
    this.resident = true;
    this.closePrompt = null;
    this.deps.windows.hideMain();
    this.tray.presentForBackgroundBuild(this.activity);
    this.tray.showFirstMinimizeToast(this.activity);
    this.refreshChrome();
  }

  electronQuitCount(): number {
    return this.electronQuits;
  }

  private finishElectronQuit(): void {
    this.allowQuit = true;
    this.electronQuits += 1;
    this.boundQuit();
  }

  private refreshChrome(): void {
    const force = this.keepInTray || this.resident;
    this.tray.sync(this.activity, force);
    this.blocker.sync({
      state: this.activity.state,
      batteryPercent: this.activity.batteryPercent,
    });
  }

  private attachWindow(window: ElectronBrowserWindowShape | null): void {
    if (!window) return;
    this.recovery.attach({
      on: (event, listener) => {
        if (event === "unresponsive") window.on("unresponsive", () => listener());
      },
      webContents: {
        on: (_event, listener) => {
          window.webContents.on("render-process-gone", (...args) => {
            listener(crashDetails(args[1] ?? args[0]));
          });
        },
        reload: () => window.webContents.reload(),
      },
    });
    window.on("close", (...args) => {
      if (this.allowQuit) return;
      const event = args[0];
      if (
        typeof event === "object" &&
        event !== null &&
        "preventDefault" in event &&
        typeof event.preventDefault === "function"
      ) {
        event.preventDefault();
      }
      void this.handleWindowClose();
    });
  }
}
