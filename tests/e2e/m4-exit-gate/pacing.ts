import { AimdConcurrencyRegulator, harnessCeilingPpm, windDownThresholdPpm } from "@ef-harness/providers";
import {
  AIMD_START_CWND,
  PPM_SCALE,
  RESERVE_EDGE_ACTIVE_PPM,
  RESERVE_EDGE_QUEUED,
  RESERVE_EDGE_QUEUED_PPM,
  RESERVE_EDGE_USED_NUMERATOR,
} from "./constants.js";

export type SlotDecision = "granted" | "wind_down" | "cwnd" | "ceiling";

/**
 * Local port of Task 140 AllowancePacingController / AimdConcurrencyRegulator.
 * Ceiling is the full window minus the personal reserve. Wind-down is 90% of that ceiling.
 */
export class AllowancePacingController {
  readonly ceilingPpm: number;
  readonly windDownPpm: number;
  usedPpm = 0;
  inFlightPpm = 0;
  active = 0;
  cwnd: number;
  peakCwnd: number;
  prematureLockouts = 0;
  usageLimitEvents = 0;
  windDownTriggers = 0;
  cwndAfter429: number | null = null;
  private guards = true;
  private readonly clock = { t: 0 };
  private readonly aimd: AimdConcurrencyRegulator;

  constructor(reserveFraction: number, startCwnd = AIMD_START_CWND) {
    this.ceilingPpm = harnessCeilingPpm(reserveFraction);
    this.windDownPpm = windDownThresholdPpm(this.ceilingPpm);
    this.aimd = new AimdConcurrencyRegulator({
      connectionMaxCap: Math.max(startCwnd, 8),
      hardwareCap: Math.max(startCwnd, 8),
      now: () => this.clock.t,
      random: () => 0,
    });
    if (startCwnd !== this.aimd.value) {
      this.cwnd = startCwnd;
      this.peakCwnd = startCwnd;
    } else {
      this.cwnd = this.aimd.value;
      this.peakCwnd = this.aimd.value;
    }
  }

  disableGuards(): void {
    this.guards = false;
  }

  seed(usedPpm: number, inFlightPpm: number, active: number): void {
    this.usedPpm = usedPpm;
    this.inFlightPpm = inFlightPpm;
    this.active = active;
  }

  requestSlot(reservePpm: number): SlotDecision {
    if (this.cwnd <= 0) return "ceiling";
    const projected = this.usedPpm + this.inFlightPpm;
    if (this.guards && projected >= this.windDownPpm) {
      this.windDownTriggers += 1;
      return "wind_down";
    }
    if (this.guards && projected + reservePpm > this.ceilingPpm) return "ceiling";
    if (this.active >= this.cwnd) return "cwnd";
    this.active += 1;
    this.inFlightPpm += reservePpm;
    return "granted";
  }

  settle(reservePpm: number, actualPpm: number, nowMs: number): void {
    this.active = Math.max(0, this.active - 1);
    this.inFlightPpm = Math.max(0, this.inFlightPpm - reservePpm);
    this.usedPpm += actualPpm;
    this.noteClean(nowMs);
  }

  abortInFlight(reservePpm: number): void {
    this.active = Math.max(0, this.active - 1);
    this.inFlightPpm = Math.max(0, this.inFlightPpm - reservePpm);
  }

  noteClean(nowMs: number): void {
    this.clock.t = nowMs;
    if (this.cwnd <= 0) return;
    this.aimd.noteCleanCompletion(true);
    this.cwnd = this.aimd.value;
    if (this.cwnd > this.peakCwnd) this.peakCwnd = this.cwnd;
  }

  noteTransient429(nowMs: number): void {
    this.clock.t = nowMs;
    if (this.cwnd <= 0) return;
    const halved = this.aimd.noteTransient429(20_000);
    this.cwnd = halved.cwnd;
    this.cwndAfter429 = this.cwndAfter429 === null ? this.cwnd : Math.min(this.cwndAfter429, this.cwnd);
  }

  /** Abrupt usage_limit_reached while a turn is still in flight and under the ceiling. */
  noteAbruptUsageLimit(): void {
    this.usageLimitEvents += 1;
    if (this.active > 0 && this.usedPpm < this.ceilingPpm) this.prematureLockouts += 1;
    this.cwnd = 0;
  }

  remainingPpm(): number {
    return PPM_SCALE - this.usedPpm;
  }
}

export function reservePpm(tokens: number, ppmPer1k: number, margin: number): number {
  return Math.round((tokens / 1000) * ppmPer1k * margin);
}

export interface ReserveBoundary {
  readonly started: number;
  readonly usedPpm: number;
  readonly remainingPpm: number;
  readonly windDownTriggered: boolean;
  readonly ceilingPpm: number;
  readonly windDownPpm: number;
  readonly ok: boolean;
}

/**
 * Window already at 89% of the harness ceiling with one active turn and three queued workers.
 * Wind-down must refuse the queue and leave the 20% personal reserve intact.
 */
export function runReserveBoundary(ignoreWindDown: boolean): ReserveBoundary {
  const pacing = new AllowancePacingController(0.2, ignoreWindDown ? 8 : AIMD_START_CWND);
  const seeded = Math.floor((pacing.ceilingPpm * RESERVE_EDGE_USED_NUMERATOR) / 100);
  pacing.seed(seeded, RESERVE_EDGE_ACTIVE_PPM, 1);
  if (ignoreWindDown) pacing.disableGuards();
  let started = 0;
  for (let index = 0; index < RESERVE_EDGE_QUEUED; index += 1) {
    if (pacing.requestSlot(RESERVE_EDGE_QUEUED_PPM) === "granted") started += 1;
  }
  pacing.settle(RESERVE_EDGE_ACTIVE_PPM, RESERVE_EDGE_ACTIVE_PPM, 0);
  for (let index = 0; index < started; index += 1) {
    pacing.settle(RESERVE_EDGE_QUEUED_PPM, RESERVE_EDGE_QUEUED_PPM, 0);
  }
  const remainingPpm = pacing.remainingPpm();
  const reserveFloor = Math.round(0.2 * PPM_SCALE);
  const ok =
    !ignoreWindDown &&
    started === 0 &&
    pacing.windDownTriggers > 0 &&
    remainingPpm >= reserveFloor &&
    pacing.usedPpm <= pacing.ceilingPpm &&
    pacing.windDownPpm === 720_000;
  return {
    started,
    usedPpm: pacing.usedPpm,
    remainingPpm,
    windDownTriggered: pacing.windDownTriggers > 0 || pacing.usedPpm >= pacing.windDownPpm,
    ceilingPpm: pacing.ceilingPpm,
    windDownPpm: pacing.windDownPpm,
    ok,
  };
}
