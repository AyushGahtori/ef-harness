import type { PressureHysteresisStateMachine } from "../../shell/ports.js";
import type { PressureLevel, PressureMachinePort, PressureShiftEvent } from "./types.js";

/**
 * Structural view of Task 118 `PressureHysteresisStateMachine`:
 * the live level is `.pressure` and `.subscribe` receives that level.
 */
export interface GovernorPressureMachine {
  readonly pressure: PressureLevel;
  subscribe(listener: (level: PressureLevel) => void): () => void;
}

/** Shell Task 122 machine publishes snapshots. Adapt it to `.pressure`. */
export function governorPressureFromShell(machine: PressureHysteresisStateMachine): GovernorPressureMachine {
  let level = machine.snapshot().level;
  const listeners = new Set<(next: PressureLevel) => void>();
  machine.subscribe((snapshot) => {
    level = snapshot.level;
    for (const listener of listeners) listener(level);
  });
  return {
    get pressure() {
      return level;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Present a Task 118 pressure machine as the office `PressureMachinePort`. */
export function bindPressureHysteresisStateMachine(machine: GovernorPressureMachine): PressureMachinePort {
  return {
    get pressure() {
      return machine.pressure;
    },
    subscribe(listener) {
      let previous = machine.pressure;
      return machine.subscribe((level) => {
        const event: PressureShiftEvent = {
          from: previous,
          to: level,
          atMs: Date.now(),
          orangeEntered: previous !== "ORANGE" && level === "ORANGE",
        };
        previous = level;
        listener(event);
      });
    },
  };
}
