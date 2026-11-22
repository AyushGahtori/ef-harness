import type {
  DaemonLifecycleClient,
  ImmediateKernelStopPort,
  PopOutWindowPort,
  WindowHost,
} from "./ports.js";
import {
  IDLE_QUIT_BUDGET_MS,
  PAUSE_AND_QUIT_BUDGET_MS,
  QUIT_CHOICES,
  assertExactQuitChoices,
  hasActiveExecution,
  type BuildActivity,
  type QuitChoiceId,
  type QuitPrompt,
  type QuitSource,
} from "./types.js";
import type { SystemTrayController } from "./system-tray-controller.js";

export type QuitIntercept =
  | { readonly kind: "immediate"; readonly dialogShown: false }
  | { readonly kind: "prompt"; readonly dialogShown: true; readonly prompt: QuitPrompt }
  | { readonly kind: "already-open"; readonly dialogShown: true; readonly prompt: QuitPrompt };

export type QuitResolution =
  | {
      readonly choice: "keep-building-in-background";
      readonly dialogShown: true;
      readonly rendererDestroyed: true;
      readonly trayVisible: true;
      readonly daemonKeptRunning: true;
      readonly electronQuit: false;
      readonly buildsInterrupted: false;
    }
  | {
      readonly choice: "pause-safely-and-quit";
      readonly dialogShown: true;
      readonly electronQuit: true;
      readonly daemonKeptRunning: false;
      readonly orphanedProcesses: 0;
      readonly elapsedMs: number;
      readonly walModes: readonly ["PASSIVE", "TRUNCATE"];
      readonly llmCalls: 0;
      readonly buildsInterrupted: true;
    }
  | {
      readonly choice: "cancel";
      readonly dialogShown: true;
      readonly electronQuit: false;
      readonly buildsInterrupted: false;
      readonly windowVisible: true;
      readonly daemonKeptRunning: true;
    };

export interface IdleQuitResolution {
  readonly choice: "idle-quit";
  readonly dialogShown: false;
  readonly elapsedMs: number;
  readonly electronQuit: true;
  readonly daemonKeptRunning: boolean;
  readonly orphanedProcesses: 0;
}

export interface QuitDialogDependencies {
  readonly getActivity: () => BuildActivity;
  readonly now: () => number;
  readonly daemon: DaemonLifecycleClient;
  readonly stop: ImmediateKernelStopPort;
  readonly popOuts: PopOutWindowPort;
  readonly windows: WindowHost;
  readonly tray: SystemTrayController;
  readonly requestElectronQuit: () => void;
  readonly onPrompt?: (prompt: QuitPrompt) => void;
}

export class QuitWhileBuildingDialog {
  private pending: QuitPrompt | null = null;

  constructor(private readonly deps: QuitDialogDependencies) {
    assertExactQuitChoices(QUIT_CHOICES);
  }

  currentPrompt(): QuitPrompt | null {
    return this.pending;
  }

  intercept(source: QuitSource): QuitIntercept {
    if (this.pending) return { kind: "already-open", dialogShown: true, prompt: this.pending };
    if (!hasActiveExecution(this.deps.getActivity())) {
      return { kind: "immediate", dialogShown: false };
    }
    const prompt: QuitPrompt = {
      title: "Quit while building?",
      source,
      choices: QUIT_CHOICES,
    };
    this.pending = prompt;
    this.deps.onPrompt?.(prompt);
    return { kind: "prompt", dialogShown: true, prompt };
  }

  async choose(choice: QuitChoiceId): Promise<QuitResolution> {
    if (!this.pending) throw new Error("Quit while building dialog is not open");
    this.pending = null;
    if (choice === "keep-building-in-background") return this.keepBuilding();
    if (choice === "pause-safely-and-quit") return this.pauseAndQuit();
    return this.cancel();
  }

  async completeImmediateQuit(): Promise<IdleQuitResolution> {
    if (hasActiveExecution(this.deps.getActivity())) {
      throw new Error("Idle quit is only valid when no build, verification, or merge is active");
    }
    const started = this.deps.now();
    const background = this.deps.getActivity().backgroundSyncActive;
    const response = await this.deps.daemon.shutdown({
      mode: background ? "detach_ui_keep_running" : "drain_and_exit",
      reason: background ? "idle-quit-background-sync" : "idle-quit",
      deadlineMs: IDLE_QUIT_BUDGET_MS,
      idle: true,
    });
    const elapsedMs = this.deps.now() - started;
    if (elapsedMs >= IDLE_QUIT_BUDGET_MS) {
      throw new Error("Idle quit exceeded 1s");
    }
    if (response.orphanedProcesses !== 0) {
      throw new Error("Idle quit left orphaned processes");
    }
    await this.deps.popOuts.closeAll("primary-quit");
    this.deps.windows.destroyRenderers();
    this.deps.requestElectronQuit();
    return {
      choice: "idle-quit",
      dialogShown: false,
      elapsedMs,
      electronQuit: true,
      daemonKeptRunning: background,
      orphanedProcesses: 0,
    };
  }

  private async keepBuilding(): Promise<QuitResolution> {
    const activity = this.deps.getActivity();
    await this.deps.popOuts.closeAll("keep-building");
    this.deps.windows.destroyRenderers();
    this.deps.tray.presentForBackgroundBuild(activity);
    this.deps.tray.showFirstMinimizeToast(activity);
    const response = await this.deps.daemon.shutdown({
      mode: "detach_ui_keep_running",
      reason: "keep-building-in-background",
      deadlineMs: PAUSE_AND_QUIT_BUDGET_MS,
    });
    if (!response.daemonKeptRunning || response.exited) {
      throw new Error("Keep building must leave detached harnessd running");
    }
    if (!this.deps.tray.isVisible) {
      throw new Error("Keep building must leave the tray icon visible");
    }
    return {
      choice: "keep-building-in-background",
      dialogShown: true,
      rendererDestroyed: true,
      trayVisible: true,
      daemonKeptRunning: true,
      electronQuit: false,
      buildsInterrupted: false,
    };
  }

  private async pauseAndQuit(): Promise<QuitResolution> {
    const started = this.deps.now();
    const pause = await this.deps.stop.pauseSafely({
      reason: "pause-safely-and-quit",
      graceMs: PAUSE_AND_QUIT_BUDGET_MS,
    });
    if (pause.llmCalls !== 0 || pause.orphanedPids !== 0 || !pause.wipPreserved) {
      throw new Error("Pause safely must checkpoint with zero orphaned processes and zero LLM calls");
    }
    const response = await this.deps.daemon.shutdown({
      mode: "drain_and_exit",
      reason: "pause-safely-and-quit",
      deadlineMs: PAUSE_AND_QUIT_BUDGET_MS,
    });
    const elapsedMs = this.deps.now() - started;
    if (elapsedMs > PAUSE_AND_QUIT_BUDGET_MS) {
      throw new Error("Pause safely & Quit exceeded 10s");
    }
    if (response.orphanedProcesses !== 0 || response.daemonKeptRunning || !response.stateDbIntact) {
      throw new Error("Pause safely & Quit must exit harnessd with an intact state.db and zero orphans");
    }
    if (response.walModes[0] !== "PASSIVE" || response.walModes[1] !== "TRUNCATE") {
      throw new Error("Pause safely & Quit must checkpoint the SQLite WAL with PASSIVE then TRUNCATE");
    }
    await this.deps.popOuts.closeAll("primary-quit");
    this.deps.windows.destroyRenderers();
    this.deps.requestElectronQuit();
    return {
      choice: "pause-safely-and-quit",
      dialogShown: true,
      electronQuit: true,
      daemonKeptRunning: false,
      orphanedProcesses: 0,
      elapsedMs,
      walModes: ["PASSIVE", "TRUNCATE"],
      llmCalls: 0,
      buildsInterrupted: true,
    };
  }

  private cancel(): QuitResolution {
    if (!this.deps.windows.isMainVisible()) {
      throw new Error("Cancel must leave the window open");
    }
    return {
      choice: "cancel",
      dialogShown: true,
      electronQuit: false,
      buildsInterrupted: false,
      windowVisible: true,
      daemonKeptRunning: true,
    };
  }
}
