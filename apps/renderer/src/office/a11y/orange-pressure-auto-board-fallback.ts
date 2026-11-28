import type {
  BoardViewPort,
  CenterTabPort,
  PixiTickerPort,
  PressureLevel,
  PressureMachinePort,
} from "./types.js";

export const ORANGE_FALLBACK_BANNER =
  "Switched to Board view to keep your laptop responsive (RAM pressure) · Switch back to Office when ready";

export const GREEN_RECOVERY_OFFER = "Switch back to Office";

export interface OrangeFallbackSnapshot {
  readonly autoFallbackActive: boolean;
  readonly userOverrodeOrangeFallback: boolean;
  readonly banner: string | null;
  readonly recoveryOffer: boolean;
  readonly highRamTooltip: boolean;
  readonly pixiStopped: boolean;
}

function isPressureFallback(level: PressureLevel): boolean {
  return level === "ORANGE" || level === "RED";
}

/**
 * Subscribes to governor pressure and falls back to Board View on ORANGE/RED.
 */
export class OrangePressureAutoBoardFallback {
  private autoFallbackActive = false;
  private userOverrodeOrangeFallback = false;
  private recoveryOffer = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly pressure: PressureMachinePort,
    private readonly tabs: CenterTabPort,
    private readonly board: BoardViewPort,
    private readonly pixi: PixiTickerPort,
  ) {}

  start(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.pressure.subscribe((event) => {
      this.onPressure(event.to);
    });
    this.onPressure(this.pressure.pressure);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  setUserOverride(active: boolean): OrangeFallbackSnapshot {
    this.userOverrodeOrangeFallback = active;
    if (active && isPressureFallback(this.pressure.pressure)) {
      this.tabs.setTab("office");
      this.pixi.start();
    }
    return this.snapshot();
  }

  acceptRecoveryOffer(): OrangeFallbackSnapshot {
    if (!this.recoveryOffer) return this.snapshot();
    this.recoveryOffer = false;
    this.tabs.setTab("office");
    this.pixi.start();
    return this.snapshot();
  }

  snapshot(): OrangeFallbackSnapshot {
    const level = this.pressure.pressure;
    const pressured = isPressureFallback(level);
    return {
      autoFallbackActive: this.autoFallbackActive,
      userOverrodeOrangeFallback: this.userOverrodeOrangeFallback,
      banner: this.autoFallbackActive ? ORANGE_FALLBACK_BANNER : null,
      recoveryOffer: this.recoveryOffer,
      highRamTooltip: pressured && this.userOverrodeOrangeFallback && this.tabs.activeTab === "office",
      pixiStopped: !this.pixi.running,
    };
  }

  private onPressure(level: PressureLevel): void {
    if (isPressureFallback(level)) {
      if (this.userOverrodeOrangeFallback) {
        this.recoveryOffer = false;
        return;
      }
      this.autoFallbackActive = true;
      this.recoveryOffer = false;
      this.pixi.stop();
      this.tabs.setTab("board");
      this.board.showBoard(this.board.currentSelection());
      return;
    }
    if (level === "GREEN" && this.autoFallbackActive) {
      this.recoveryOffer = true;
      this.autoFallbackActive = false;
    }
  }
}