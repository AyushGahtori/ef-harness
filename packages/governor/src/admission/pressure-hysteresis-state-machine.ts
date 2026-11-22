import { stepHysteresis, type PendingTarget } from "./hysteresis.js";
import type { HardwareSnapshot, ResourceTelemetryProvider } from "./ports/hardware-snapshot.js";
import {
  actionsFor,
  activeDrivers,
  desiredLevel,
  hardwarePressureCard,
  isEmergency,
  primaryDriver,
  signalsFromSnapshot,
  type HardwarePressureCard,
  type PressureActions,
} from "./pressure-model.js";
import { ENTER_WORSE_MS, RECOVER_BETTER_MS } from "./thresholds.js";
import { pressureRank, type PressureLevel } from "./types.js";

export interface PressureShiftEvent {
  readonly from: PressureLevel;
  readonly to: PressureLevel;
  readonly atMs: number;
  readonly elapsedMs: number;
  readonly emergency: boolean;
  readonly primaryDriver: string;
  readonly drivers: readonly string[];
  readonly eventNames: readonly string[];
  readonly orangeEntered: boolean;
  readonly actions: PressureActions;
  readonly card: HardwarePressureCard | null;
}

export interface PressureShiftListener {
  onPressureShift(event: PressureShiftEvent): void;
}

export interface PressureMachineOptions {
  readonly baseWarmSlots?: number;
  readonly pollMs?: number;
}

/**
 * Four-level pressure with a 10 s enter debounce and a 30 s recovery debounce.
 * Low-memory notifications and under 2 GB of disk jump to RED in 0 s.
 */
export class PressureHysteresisStateMachine {
  private level: PressureLevel = "GREEN";
  private pending: PendingTarget<PressureLevel> | null = null;
  private readonly shifts: PressureShiftEvent[] = [];
  private readonly listeners: PressureShiftListener[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly baseWarmSlots: number;
  private readonly telemetry: ResourceTelemetryProvider;

  constructor(telemetry: ResourceTelemetryProvider, options: PressureMachineOptions = {}) {
    this.telemetry = telemetry;
    this.baseWarmSlots = options.baseWarmSlots ?? 2;
  }

  get pressure(): PressureLevel {
    return this.level;
  }

  get events(): readonly PressureShiftEvent[] {
    return this.shifts;
  }

  get actions(): PressureActions {
    return actionsFor(this.level, this.baseWarmSlots);
  }

  subscribe(listener: PressureShiftListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  start(pollMs = 1_000): void {
    this.stop();
    this.observe(Date.now());
    this.timer = setInterval(() => {
      this.observe(Date.now());
    }, pollMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  observe(
    nowMs: number,
    snapshot?: HardwareSnapshot,
    options: { readonly instantRecovery?: boolean } = {},
  ): PressureShiftEvent | null {
    const sample = snapshot ?? this.telemetry.current(nowMs);
    const signals = signalsFromSnapshot(sample);
    const target = desiredLevel(this.level, signals);
    const emergency = isEmergency(signals) && target === "RED" && this.level !== "RED";
    const stepped = stepHysteresis({
      level: this.level,
      pending: this.pending,
      target,
      nowMs,
      rank: pressureRank,
      enterMs: ENTER_WORSE_MS,
      recoverMs: RECOVER_BETTER_MS,
      instant: emergency,
      instantRecovery: options.instantRecovery === true,
    });
    this.pending = stepped.pending;
    if (!stepped.transition) {
      this.level = stepped.level;
      return null;
    }
    const worsening = pressureRank(stepped.transition.to) > pressureRank(stepped.transition.from);
    const driver = primaryDriver(signals, !worsening);
    const orangeEntered =
      stepped.transition.to === "ORANGE" && pressureRank(stepped.transition.from) < pressureRank("ORANGE");
    const actions = actionsFor(stepped.transition.to, this.baseWarmSlots);
    const event: PressureShiftEvent = {
      from: stepped.transition.from,
      to: stepped.transition.to,
      atMs: nowMs,
      elapsedMs: stepped.transition.elapsedMs,
      emergency: stepped.transition.emergency,
      primaryDriver: driver,
      drivers: activeDrivers(signals),
      eventNames: orangeEntered ? ["governor.orange_entered"] : [],
      orangeEntered,
      actions,
      card: actions.showHardwarePressureCard ? hardwarePressureCard(signals, driver) : null,
    };
    this.level = stepped.level;
    this.shifts.push(event);
    for (const listener of this.listeners) listener.onPressureShift(event);
    return event;
  }

  recheck(nowMs: number, snapshot?: HardwareSnapshot): PressureShiftEvent | null {
    return this.observe(nowMs, snapshot, { instantRecovery: true });
  }
}
