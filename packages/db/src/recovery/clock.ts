/** Injectable time source. Retention tests advance this instead of sleeping. */
export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class ManualClock implements Clock {
  private current: number;

  constructor(start: number) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  set(ms: number): void {
    this.current = ms;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export interface Sleeper {
  sleep(ms: number): Promise<void>;
}

export const realSleeper: Sleeper = {
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  },
};

export const immediateSleeper: Sleeper = {
  async sleep(): Promise<void> {
    await Promise.resolve();
  },
};

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** 10 attempts, waits 50 ms, 100 ms, 200 ms, 400 ms, 800 ms, then 1 s. */
export function renameRetryDelays(): readonly number[] {
  const delays: number[] = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    delays.push(Math.min(1000, 50 * 2 ** attempt));
  }
  return delays;
}
