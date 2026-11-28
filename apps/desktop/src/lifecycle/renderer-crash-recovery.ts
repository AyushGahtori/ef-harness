import { assertDaemonSurvived, type DaemonPresence, type EventStreamReconnectPort } from "./ports.js";

export interface RecoverableWebContents {
  on(event: "render-process-gone", listener: (details: { readonly reason: string }) => void): void;
  reload(): void;
}

export interface RecoverableWindow {
  on(event: "unresponsive", listener: () => void): void;
  readonly webContents: RecoverableWebContents;
}

export interface ReloadOffer {
  readonly label: "Reload UI";
  readonly reason: "render-process-gone" | "unresponsive";
  readonly detail: string;
  readonly daemonAlive: true;
}

export interface ReloadResult {
  readonly reconnected: true;
  readonly streamEpoch: number;
  readonly lostBuildProgress: 0;
  readonly elapsedMs: number;
  readonly daemonAlive: true;
}

export class RendererCrashRecovery {
  private offer: ReloadOffer | null = null;

  constructor(
    private readonly deps: {
      readonly daemon: DaemonPresence;
      readonly stream: EventStreamReconnectPort;
      readonly now: () => number;
      readonly reloadWindow: () => void;
    },
  ) {}

  currentOffer(): ReloadOffer | null {
    return this.offer;
  }

  attach(window: RecoverableWindow): void {
    window.webContents.on("render-process-gone", (details) => {
      this.noteFailure("render-process-gone", details.reason);
    });
    window.on("unresponsive", () => {
      this.noteFailure("unresponsive", "renderer-unresponsive");
    });
  }

  noteFailure(reason: "render-process-gone" | "unresponsive", detail: string): void {
    assertDaemonSurvived(this.deps.daemon);
    this.offer = {
      label: "Reload UI",
      reason,
      detail,
      daemonAlive: true,
    };
  }

  async reloadUi(): Promise<ReloadResult> {
    const started = this.deps.now();
    assertDaemonSurvived(this.deps.daemon);
    this.deps.reloadWindow();
    const sync = await this.deps.stream.resync({
      reason: this.offer?.reason === "unresponsive" ? "unresponsive" : "reload-ui",
    });
    const elapsedMs = Math.max(this.deps.now() - started, sync.elapsedMs);
    if (sync.lostEvents !== 0) {
      throw new Error("Reload UI lost build progress");
    }
    if (elapsedMs >= 1_000) {
      throw new Error("Reload UI resync exceeded 1s");
    }
    assertDaemonSurvived(this.deps.daemon);
    this.offer = null;
    return {
      reconnected: true,
      streamEpoch: sync.streamEpoch,
      lostBuildProgress: 0,
      elapsedMs,
      daemonAlive: true,
    };
  }
}
