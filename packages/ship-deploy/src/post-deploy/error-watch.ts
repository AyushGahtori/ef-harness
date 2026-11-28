import {
  CONSECUTIVE_HEALTH_FAILS,
  CRASH_LOOP_RESTART_THRESHOLD,
  DEFAULT_FIVE_XX_RATE_THRESHOLD,
  ERROR_WATCH_POLL_MS,
  ERROR_WATCH_WINDOW_MS,
  LOCAL_OFFLINE_WATCH_MESSAGE,
  UNHANDLED_EXCEPTION_THRESHOLD,
  describeDockerLogsPoll,
  describeVercelMetricsPoll,
  systemClock,
} from "./http.js";
import { sha256 } from "./redactor.js";
import type {
  CasBlobStore,
  Clock,
  DeployEnvironment,
  HostObservabilitySource,
  LocalConnectivityProbe,
  PacketSecurityRedactor,
  WatchBreach,
  WatchResult,
} from "./types.js";

export interface WatchStartInput {
  readonly deploymentId: string;
  readonly env: DeployEnvironment;
  readonly containerName?: string;
  readonly windowMs?: number;
  readonly pollMs?: number;
  readonly fiveXxRateThreshold?: number;
  readonly unhandledExceptionThreshold?: number;
  readonly onBreach?: (breach: WatchBreach, logs: readonly string[]) => Promise<void>;
}

export type WatchPhase = "starting" | "polling" | "waiting" | "paused-offline" | "done";

export interface WatchHandle {
  readonly done: Promise<WatchResult>;
  minimize(): void;
  dismissEarly(): void;
  isMinimized(): boolean;
  phase(): WatchPhase;
}

interface Controls {
  dismissed: boolean;
  minimized: boolean;
  phase: WatchPhase;
  readonly signal: AbortSignal;
}

export class TenMinuteErrorWatchMonitor {
  constructor(
    private readonly deps: {
      readonly source: HostObservabilitySource;
      readonly connectivity: LocalConnectivityProbe;
      readonly redactor: PacketSecurityRedactor;
      readonly cas: CasBlobStore;
      readonly clock?: Clock;
    },
  ) {}

  start(input: WatchStartInput): WatchHandle {
    const abort = new AbortController();
    const controls: Controls = {
      dismissed: false,
      minimized: false,
      phase: "starting",
      signal: abort.signal,
    };
    const done = this.observe(input, controls).then((result) => {
      controls.phase = "done";
      return result;
    });
    return {
      done,
      minimize(): void {
        controls.minimized = true;
      },
      dismissEarly(): void {
        controls.dismissed = true;
        abort.abort();
      },
      isMinimized: () => controls.minimized,
      phase: () => controls.phase,
    };
  }

  private async observe(input: WatchStartInput, controls: Controls): Promise<WatchResult> {
    const clock = this.deps.clock ?? systemClock;
    const windowMs = input.windowMs ?? ERROR_WATCH_WINDOW_MS;
    const pollMs = input.pollMs ?? ERROR_WATCH_POLL_MS;
    const fiveXxThreshold = input.fiveXxRateThreshold ?? DEFAULT_FIVE_XX_RATE_THRESHOLD;
    const exceptionThreshold = input.unhandledExceptionThreshold ?? UNHANDLED_EXCEPTION_THRESHOLD;
    const started = clock.now();
    const deadline = started + windowMs;
    const logs: string[] = [];
    let pollCount = 0;
    let consecutiveHealthFails = 0;
    let offlineAnnounced = false;
    let sawOffline = false;
    let breach: WatchBreach | null = null;

    while (clock.now() < deadline) {
      if (controls.dismissed) {
        return this.finish(input, controls, logs, pollCount, "dismissed-early", null);
      }
      const online = await this.deps.connectivity.isOnline();
      if (controls.dismissed) {
        return this.finish(input, controls, logs, pollCount, "dismissed-early", null);
      }
      if (!online) {
        sawOffline = true;
        controls.phase = "paused-offline";
        if (!offlineAnnounced) {
          logs.push(LOCAL_OFFLINE_WATCH_MESSAGE);
          offlineAnnounced = true;
        }
        await clock.wait(pollMs, controls.signal);
        continue;
      }
      offlineAnnounced = false;
      controls.phase = "polling";
      const sinceIso = new Date(clock.now()).toISOString();
      const pollCommand =
        this.deps.source.kind === "docker-logs"
          ? describeDockerLogsPoll(input.containerName ?? "app", sinceIso)
          : describeVercelMetricsPoll(input.deploymentId);
      const sample = await this.deps.source.poll({
        deploymentId: input.deploymentId,
        sinceIso,
        pollCommand,
      });
      pollCount += 1;
      for (const line of sample.logLines) logs.push(this.deps.redactor.redact(line));
      if (controls.dismissed) {
        return this.finish(input, controls, logs, pollCount, "dismissed-early", null);
      }

      if (!sample.healthOk) consecutiveHealthFails += 1;
      else consecutiveHealthFails = 0;

      if (consecutiveHealthFails >= CONSECUTIVE_HEALTH_FAILS) {
        breach = { kind: "consecutive-health-fails", count: consecutiveHealthFails };
      } else if (sample.containerRestarts >= CRASH_LOOP_RESTART_THRESHOLD) {
        breach = { kind: "crash-loop", restarts: sample.containerRestarts };
      } else if (fiveXxRate(sample.requests, sample.fiveXx) > fiveXxThreshold) {
        breach = {
          kind: "five-xx-spike",
          rate: fiveXxRate(sample.requests, sample.fiveXx),
          threshold: fiveXxThreshold,
        };
      } else if (sample.unhandledExceptions >= exceptionThreshold) {
        breach = {
          kind: "unhandled-exceptions",
          count: sample.unhandledExceptions,
          threshold: exceptionThreshold,
        };
      }

      if (breach) {
        if (input.onBreach) await input.onBreach(breach, logs);
        return this.finish(input, controls, logs, pollCount, "breached", breach);
      }

      controls.phase = "waiting";
      await clock.wait(pollMs, controls.signal);
    }

    if (controls.dismissed) {
      return this.finish(input, controls, logs, pollCount, "dismissed-early", null);
    }
    return this.finish(
      input,
      controls,
      logs,
      pollCount,
      sawOffline ? "paused-local-offline" : "clean",
      null,
    );
  }

  private finish(
    input: WatchStartInput,
    controls: Controls,
    logs: readonly string[],
    pollCount: number,
    verdict: WatchResult["verdict"],
    breach: WatchBreach | null,
  ): WatchResult {
    const text = this.deps.redactor.redact(logs.join("\n"));
    const stored = this.deps.cas.put({
      kind: "log",
      text: text || `watch ${input.env} ${input.deploymentId} ${verdict}`,
    });
    return {
      verdict,
      pollCount,
      logs,
      minimized: controls.minimized,
      breach,
      logArtifactHash: stored.hash,
    };
  }
}

function fiveXxRate(requests: number, fiveXx: number): number {
  if (requests > 0) return fiveXx / requests;
  return fiveXx > 0 ? 1 : 0;
}

export function watchLogFingerprint(logs: readonly string[]): string {
  return sha256(logs.join("\n"));
}
