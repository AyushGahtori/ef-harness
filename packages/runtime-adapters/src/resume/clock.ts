export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** Virtual clock for the 90-second idle park tests. */
export class ManualClock implements Clock {
  constructor(private current: number) {}

  now(): number {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current += milliseconds;
  }

  set(milliseconds: number): void {
    this.current = milliseconds;
  }
}
