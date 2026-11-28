import { DiskHeadroomGuard } from "./admission/disk-headroom-guard.js";
import { GpuWhisperPriorityArbiter } from "./admission/gpu-whisper-priority-arbiter.js";
import { HeavyLaneSemaphore } from "./admission/heavy-lane-semaphore.js";
import { PressureHysteresisStateMachine } from "./admission/pressure-hysteresis-state-machine.js";
import type { HardwareSnapshot } from "./admission/ports/hardware-snapshot.js";
import type { PressureActions } from "./admission/pressure-model.js";
import type { PressureLevel } from "./admission/types.js";
import { ThreePoolCapacityScheduler } from "./capacity-pools/scheduler.js";

export interface GovernorPressureSinks {
  readonly machine: PressureHysteresisStateMachine;
  readonly scheduler: ThreePoolCapacityScheduler;
  readonly heavyLane: HeavyLaneSemaphore;
  readonly disk: DiskHeadroomGuard;
  readonly whisper: GpuWhisperPriorityArbiter;
  readonly nowMs: number;
  readonly snapshot: HardwareSnapshot;
}

export interface GovernorPressureStep {
  readonly pressure: PressureLevel;
  readonly actions: PressureActions;
  readonly whisperHeadroomMb: number;
  readonly executionTarget: number;
}

/**
 * One sample from the hysteresis machine drives the capacity scheduler,
 * the heavy lane, and the disk guard. Whisper stays on the same tick.
 */
export function applyGovernorPressure(input: GovernorPressureSinks): GovernorPressureStep {
  const pressure = input.machine.sample(input.nowMs, input.snapshot);
  input.scheduler.setPressure(pressure);
  input.heavyLane.setPressure(pressure);
  input.disk.observe({
    project: input.snapshot.projectDisk,
    appData: input.snapshot.appDataDisk,
    nowMs: input.nowMs,
  });
  return {
    pressure,
    actions: input.machine.actions,
    whisperHeadroomMb: input.whisper.headroomMb(),
    executionTarget: input.scheduler.executionTarget(),
  };
}
