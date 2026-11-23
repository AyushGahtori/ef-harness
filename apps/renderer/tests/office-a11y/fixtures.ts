import type {
  AnimationDirectorPort,
  BoardViewPort,
  CenterTabPort,
  FocusModePort,
  InboxPort,
  MediaQueryPort,
  OfficeCameraPort,
  OfficeSelection,
  OfficeWorkerRecord,
  PhaseLayoutPresetPort,
  PixiTickerPort,
  PressureLevel,
  PressureMachinePort,
  PressureShiftEvent,
  WorkerInspectorPort,
} from "../../src/office/a11y/index.js";

export function makeWorker(
  partial: Partial<OfficeWorkerRecord> & Pick<OfficeWorkerRecord, "agentId" | "title">,
): OfficeWorkerRecord {
  return {
    roomId: "engineering_bullpen",
    stateLabel: "Running vitest",
    statusIcon: "⚙",
    priority: 1,
    ...partial,
  };
}

export function makeBullpenWave(count: number): OfficeWorkerRecord[] {
  return Array.from({ length: count }, (_, index) =>
    makeWorker({
      agentId: `A${String(index + 1).padStart(4, "0")}`,
      title: `task ${index + 1}`,
      priority: count - index,
      flagged: index < 3,
    }),
  );
}

export class MemoryMediaQuery implements MediaQueryPort {
  private reducedMotion = false;
  private forcedColors = false;

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
  }

  setForcedColors(value: boolean): void {
    this.forcedColors = value;
  }

  prefersReducedMotion(): boolean {
    return this.reducedMotion;
  }

  forcedColorsActive(): boolean {
    return this.forcedColors;
  }
}

export class MemoryAnimationDirector implements AnimationDirectorPort {
  continuousMotionCount = 0;
  motionEnabled = true;
  seated = false;

  setMotionEnabled(enabled: boolean): void {
    this.motionEnabled = enabled;
    this.continuousMotionCount = enabled ? this.continuousMotionCount || 4 : 0;
  }

  seatAllAtDesks(): void {
    this.seated = true;
    this.continuousMotionCount = 0;
  }
}

export class MemoryPhasePreset implements PhaseLayoutPresetPort {
  buildPhaseDefaultTab: "office" | "board" = "office";
}

export class MemoryPressureMachine implements PressureMachinePort {
  pressure: PressureLevel = "GREEN";
  private listeners: Array<(event: PressureShiftEvent) => void> = [];

  subscribe(listener: (event: PressureShiftEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  shift(to: PressureLevel, atMs = Date.now()): void {
    const from = this.pressure;
    this.pressure = to;
    const event: PressureShiftEvent = {
      from,
      to,
      atMs,
      orangeEntered: from !== "ORANGE" && to === "ORANGE",
    };
    for (const listener of this.listeners) listener(event);
  }
}

export class MemoryCenterTabs implements CenterTabPort {
  activeTab: "office" | "board" = "office";

  setTab(tab: "office" | "board"): void {
    this.activeTab = tab;
  }
}

export class MemoryBoardView implements BoardViewPort {
  visible = false;
  private selection: OfficeSelection | null = null;

  showBoard(selection: OfficeSelection | null): void {
    this.visible = true;
    this.selection = selection;
  }

  hideBoard(): void {
    this.visible = false;
  }

  currentSelection(): OfficeSelection | null {
    return this.selection;
  }
}

export class MemoryPixiTicker implements PixiTickerPort {
  running = true;
  frameCount = 0;

  stop(): void {
    this.running = false;
    this.frameCount = 0;
  }

  start(): void {
    this.running = true;
  }
}

export class MemoryFocusMode implements FocusModePort {
  active = false;
}

export class MemoryCamera implements OfficeCameraPort {
  readonly pans: string[] = [];
  readonly rings: Array<string | null> = [];

  panToAgent(agentId: string): void {
    this.pans.push(agentId);
  }

  setFocusRing(agentId: string | null): void {
    this.rings.push(agentId);
  }
}

export class MemoryInspector implements WorkerInspectorPort {
  readonly opened: OfficeSelection[] = [];

  open(selection: OfficeSelection): void {
    this.opened.push(selection);
  }
}

export class MemoryInbox implements InboxPort {
  opened = false;

  openFromCeoInbox(): void {
    this.opened = true;
  }
}