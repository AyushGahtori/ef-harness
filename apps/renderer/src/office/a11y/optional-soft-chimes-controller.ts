import type { ChimeCue, FocusModePort } from "./types.js";

export interface ChimeSettings {
  readonly enabled: boolean;
  readonly volume: number;
}

export interface ChimePlayback {
  readonly cue: ChimeCue;
  readonly atMs: number;
  readonly volume: number;
}

const DEFAULT_VOLUME = 0.35;

/**
 * Strictly opt-in soft chimes. Disabled by default and muted while Focus Mode is active.
 */
export class OptionalSoftChimesController {
  private enabled = false;
  private volume = DEFAULT_VOLUME;
  private readonly log: ChimePlayback[] = [];

  constructor(private readonly focusMode: FocusModePort) {}

  settings(): ChimeSettings {
    return { enabled: this.enabled, volume: this.volume };
  }

  setEnabled(enabled: boolean): ChimeSettings {
    this.enabled = enabled;
    return this.settings();
  }

  setVolume(volume: number): ChimeSettings {
    this.volume = Math.min(1, Math.max(0, volume));
    return this.settings();
  }

  play(cue: ChimeCue, atMs: number): ChimePlayback | null {
    if (!this.enabled || this.focusMode.active) return null;
    const playback: ChimePlayback = { cue, atMs, volume: this.volume };
    this.log.push(playback);
    return playback;
  }

  playbackLog(): readonly ChimePlayback[] {
    return this.log;
  }
}