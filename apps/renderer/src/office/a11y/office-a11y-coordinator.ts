import { detectHighContrastMode } from "./high-contrast-mode.js";
import { HotDeskOverflowAggregator } from "./hot-desk-overflow-aggregator.js";
import { toggleOfficeBoardView } from "./office-board-toggle.js";
import type { OfficeBoardToggleResult } from "./office-board-toggle.js";
import { OfficeReducedMotionAdapter } from "./office-reduced-motion-adapter.js";
import {
  GREEN_RECOVERY_OFFER,
  OrangePressureAutoBoardFallback,
} from "./orange-pressure-auto-board-fallback.js";
import { OptionalSoftChimesController } from "./optional-soft-chimes-controller.js";
import { OfficeSemanticMirrorTree } from "./office-semantic-mirror-tree.js";
import type {
  AnimationDirectorPort,
  BoardViewPort,
  CenterTabPort,
  FocusModePort,
  MediaQueryPort,
  OfficeSelection,
  OfficeWorkerRecord,
  PhaseLayoutPresetPort,
  PixiTickerPort,
  PressureMachinePort,
  WorkerInspectorPort,
} from "./types.js";
import type { InboxPort, OfficeCameraPort } from "./types.js";

export interface OfficeA11yCoordinatorOptions {
  readonly media: MediaQueryPort;
  readonly director: AnimationDirectorPort;
  readonly phasePreset: PhaseLayoutPresetPort;
  readonly pressure: PressureMachinePort;
  readonly tabs: CenterTabPort;
  readonly board: BoardViewPort;
  readonly pixi: PixiTickerPort;
  readonly focusMode: FocusModePort;
  readonly camera: OfficeCameraPort;
  readonly inspector: WorkerInspectorPort;
  readonly inbox: InboxPort;
}

export interface OfficeA11ySnapshot {
  readonly activeTab: "office" | "board";
  readonly reducedMotionActive: boolean;
  readonly continuousMotionCount: number;
  readonly overflowLabel: string | null;
  readonly banner: string | null;
  readonly recoveryOffer: string | null;
  readonly highContrastMessage: string | null;
  readonly chimesEnabled: boolean;
}

export class OfficeA11yCoordinator {
  readonly reducedMotion: OfficeReducedMotionAdapter;
  readonly orangeFallback: OrangePressureAutoBoardFallback;
  readonly mirror: OfficeSemanticMirrorTree;
  readonly overflow: HotDeskOverflowAggregator;
  readonly chimes: OptionalSoftChimesController;
  private selection: OfficeSelection | null = null;
  private workers: OfficeWorkerRecord[] = [];
  private inboxCount = 0;

  constructor(private readonly ports: OfficeA11yCoordinatorOptions) {
    this.reducedMotion = new OfficeReducedMotionAdapter(
      ports.media,
      ports.director,
      ports.phasePreset,
    );
    this.orangeFallback = new OrangePressureAutoBoardFallback(
      ports.pressure,
      ports.tabs,
      ports.board,
      ports.pixi,
    );
    this.mirror = new OfficeSemanticMirrorTree(ports.camera, ports.inspector, ports.inbox);
    this.overflow = new HotDeskOverflowAggregator();
    this.chimes = new OptionalSoftChimesController(ports.focusMode);
  }

  start(): void {
    this.orangeFallback.start();
    this.reducedMotion.observeOsPreference();
  }

  stop(): void {
    this.orangeFallback.stop();
  }

  setWorkers(workers: readonly OfficeWorkerRecord[], inboxCount: number): void {
    this.workers = [...workers];
    this.inboxCount = inboxCount;
    this.mirror.replaceWorkers(workers, inboxCount);
  }

  setSelection(selection: OfficeSelection | null): void {
    this.selection = selection;
  }

  toggleOfficeBoard(): OfficeBoardToggleResult {
    return toggleOfficeBoardView({
      tabs: this.ports.tabs,
      board: this.ports.board,
      selection: this.selection,
    });
  }

  acceptRecoveryOffer(): void {
    this.orangeFallback.acceptRecoveryOffer();
  }

  snapshot(): OfficeA11ySnapshot {
    const motion = this.reducedMotion.snapshot();
    const fallback = this.orangeFallback.snapshot();
    const guidance = detectHighContrastMode(this.ports.media);
    const overflow = this.overflow.aggregate(this.workers);
    return {
      activeTab: this.ports.tabs.activeTab,
      reducedMotionActive: motion.active,
      continuousMotionCount: this.ports.director.continuousMotionCount,
      overflowLabel: overflow.overflowCount > 0 ? overflow.overflowLabel : null,
      banner: fallback.banner,
      recoveryOffer: fallback.recoveryOffer ? GREEN_RECOVERY_OFFER : null,
      highContrastMessage: guidance.message,
      chimesEnabled: this.chimes.settings().enabled,
    };
  }

  renderMirrorHtml(): string {
    return this.mirror.renderHtml();
  }
}