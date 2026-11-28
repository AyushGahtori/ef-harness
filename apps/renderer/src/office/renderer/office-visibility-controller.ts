export type TickerLike = {
  start: () => void;
  stop: () => void;
  readonly started: boolean;
  add?: (fn: () => void) => void;
  remove?: (fn: () => void) => void;
};

export type VisibilitySnapshot = {
  readonly tabActive: boolean;
  readonly documentVisible: boolean;
  readonly windowMinimized: boolean;
};

/** Pauses Pixi ticker whenever Office is not visibly on screen (Task 162 invariant). */
export class OfficeVisibilityController {
  private tabActive = true;
  private documentVisible = true;
  private windowMinimized = false;
  private framesWhilePaused = 0;
  private ticker: TickerLike | null = null;

  bindTicker(ticker: TickerLike): void {
    this.ticker = ticker;
    this.syncTicker();
  }

  setTabActive(active: boolean): void {
    this.tabActive = active;
    this.syncTicker();
  }

  setDocumentVisible(visible: boolean): void {
    this.documentVisible = visible;
    this.syncTicker();
  }

  setWindowMinimized(minimized: boolean): void {
    this.windowMinimized = minimized;
    this.syncTicker();
  }

  snapshot(): VisibilitySnapshot {
    return {
      tabActive: this.tabActive,
      documentVisible: this.documentVisible,
      windowMinimized: this.windowMinimized,
    };
  }

  shouldRender(): boolean {
    return this.tabActive && this.documentVisible && !this.windowMinimized;
  }

  framesRenderedWhilePaused(): number {
    return this.framesWhilePaused;
  }

  /** Call from ticker hook in tests to count forbidden frames. */
  onTickerFrame(): void {
    if (!this.shouldRender()) {
      this.framesWhilePaused += 1;
    }
  }

  private syncTicker(): void {
    if (!this.ticker) {
      return;
    }
    if (this.shouldRender()) {
      this.ticker.start();
    } else {
      this.ticker.stop();
    }
  }
}