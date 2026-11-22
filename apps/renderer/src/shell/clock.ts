import { SIMULATED_FRAME_MS } from "./types.js";

export interface AnimationFrameClock {
  now(): number;
  hidden(): boolean;
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
}

export class ManualClock implements AnimationFrameClock {
  time = 0;
  documentHidden = false;
  private nextId = 1;
  private frames: { id: number; callback: (time: number) => void }[] = [];

  now(): number {
    return this.time;
  }

  hidden(): boolean {
    return this.documentHidden;
  }

  requestFrame(callback: (time: number) => void): number {
    const id = this.nextId;
    this.nextId += 1;
    this.frames.push({ id, callback });
    return id;
  }

  cancelFrame(id: number): void {
    this.frames = this.frames.filter((frame) => frame.id !== id);
  }

  pendingFrames(): number {
    return this.frames.length;
  }

  flush(advanceMs = SIMULATED_FRAME_MS): void {
    this.time += advanceMs;
    const due = this.frames;
    this.frames = [];
    for (const frame of due) frame.callback(this.time);
  }
}

export interface AnimationHost {
  now(): number;
  hidden(): boolean;
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
}

export function createHostClock(host: AnimationHost): AnimationFrameClock {
  return {
    now: () => host.now(),
    hidden: () => host.hidden(),
    requestFrame: (callback) => host.requestAnimationFrame(callback),
    cancelFrame: (id) => host.cancelAnimationFrame(id),
  };
}
