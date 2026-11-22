import { neutralUi } from "./snapshot.js";
import {
  UI_HEARTBEAT_HZ,
  UI_LATENCY_PRESSURE_MS,
  type UiHeartbeat,
  type UiLatencySample,
} from "./types.js";

export class UiLatencyHeartbeatMonitor {
  private latestVisible: { readonly uiLatencyMs: number; readonly interacting: boolean } | null = null;
  private hidden = false;
  private suppressed = false;
  private consecutiveLag = 0;

  constructor(private readonly sustainSamples = 2) {}

  ingest(beat: UiHeartbeat): void {
    if (beat.documentHidden) {
      this.hidden = true;
      this.suppressed = true;
      return;
    }
    this.hidden = false;
    this.suppressed = false;
    this.latestVisible = { uiLatencyMs: beat.uiLatencyMs, interacting: beat.interacting };
    if (beat.interacting && beat.uiLatencyMs > UI_LATENCY_PRESSURE_MS) this.consecutiveLag += 1;
    else this.consecutiveLag = 0;
  }

  assessment(): UiLatencySample {
    const visibleLag =
      !this.hidden &&
      this.latestVisible !== null &&
      this.latestVisible.interacting &&
      this.latestVisible.uiLatencyMs > UI_LATENCY_PRESSURE_MS;
    const pressure = visibleLag && this.consecutiveLag >= this.sustainSamples;
    if (this.hidden) {
      return {
        uiLatencyMs: null,
        windowVisible: false,
        interacting: false,
        pressure: false,
        suppressedHidden: this.suppressed,
        consecutiveLagSamples: 0,
        heartbeatHz: UI_HEARTBEAT_HZ,
      };
    }
    return {
      uiLatencyMs: this.latestVisible?.uiLatencyMs ?? null,
      windowVisible: true,
      interacting: this.latestVisible?.interacting ?? false,
      pressure,
      suppressedHidden: false,
      consecutiveLagSamples: this.consecutiveLag,
      heartbeatHz: UI_HEARTBEAT_HZ,
    };
  }

  reset(): void {
    this.latestVisible = null;
    this.hidden = false;
    this.suppressed = false;
    this.consecutiveLag = 0;
  }
}

export function idleUiAssessment(): UiLatencySample {
  return neutralUi();
}
