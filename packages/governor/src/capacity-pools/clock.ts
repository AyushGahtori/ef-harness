import { CapacityError } from "./errors.js";

export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now(): number {
    return Date.now();
  },
};

export class ManualClock implements Clock {
  private value: number;

  constructor(start = 0) {
    if (!Number.isFinite(start) || start < 0) {
      throw new CapacityError("clock", "Clock start must be a non-negative finite number");
    }
    this.value = start;
  }

  now(): number {
    return this.value;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new CapacityError("clock", "Clock can only advance by a non-negative finite amount");
    }
    this.value += ms;
  }

  set(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new CapacityError("clock", "Clock time must be a non-negative finite number");
    }
    this.value = ms;
  }
}
