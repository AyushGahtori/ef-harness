import { OfficeCastProjector } from "../cast/office-cast-projector.js";
import {
  OfficeInteractionController,
  type InteractionEffect,
  type OfficeClickTarget,
} from "../cast/office-interaction-controller.js";
import type {
  OfficeCanonicalSnapshot,
  OfficeCastScene,
  OfficeHealthSignal,
  OfficeWorkerRecord as CastWorker,
} from "../cast/types.js";
import { OfficeCastProjectorPortAdapter } from "../director/cast-projector-adapter.js";
import { FloorPlanWalkableGridPort } from "../director/floor-plan-walkable-grid.js";
import { TruthfulAnimationDirector } from "../director/truthful-animation-director.js";
import { OfficeCameraController } from "../renderer/office-camera-controller.js";
import type { LoadedFloorPlan } from "../renderer/types.js";
import { BoardCockpitView } from "../../cockpit/board/board-cockpit-view.js";
import type { BoardLaneId, WorkerInspectorPort as BoardInspectorPort } from "../../cockpit/board/types.js";
import { BoardHealthSignalEngine, type HealthBoardView } from "../../cockpit/health/engine.js";
import type { HealthSignal } from "../../cockpit/health/types.js";
import type { CalmInboxPanel } from "../../cockpit/inbox/panel.js";
import { PhaseLayoutPresetManager } from "../../presets/phase-layout-preset-manager.js";
import type { PhaseEnvironment } from "../../presets/types.js";
import { ShellLayoutContext } from "../../shell/shell.js";
import type { CenterTabId } from "../../shell/types.js";
import { OfficeA11yCoordinator } from "./office-a11y-coordinator.js";
import { bindPressureHysteresisStateMachine, type GovernorPressureMachine } from "./pressure-binding.js";
import type {
  BoardViewPort,
  CenterTabPort,
  CenterWorkspaceTab,
  FocusModePort,
  MediaQueryPort,
  OfficeCameraPort,
  OfficeSelection,
  OfficeWorkerRecord,
  PhaseLayoutPresetPort,
  PixiTickerPort,
} from "./types.js";

export interface OfficeViewMount {
  readonly plan: LoadedFloorPlan;
  readonly pressure: GovernorPressureMachine;
  readonly layout: ShellLayoutContext;
  readonly presets: PhaseLayoutPresetManager;
  readonly environment: PhaseEnvironment;
  readonly board: BoardCockpitView;
  readonly health: BoardHealthSignalEngine;
  readonly inspector: BoardInspectorPort;
  readonly inbox: Pick<CalmInboxPanel, "openManually">;
  readonly camera: OfficeCameraController;
  readonly pixi: PixiTickerPort;
  readonly media: MediaQueryPort;
}

class PhaseTab implements PhaseLayoutPresetPort {
  buildPhaseDefaultTab: CenterWorkspaceTab = "office";
}

class LiveBoardPort implements BoardViewPort {
  visible: boolean;
  private selection: OfficeSelection | null = null;

  constructor(
    initial: boolean,
    private readonly activate: (selection: OfficeSelection) => void,
    private readonly readSelection: () => OfficeSelection | null,
  ) {
    this.visible = initial;
  }

  showBoard(selection: OfficeSelection | null): void {
    this.visible = true;
    this.selection = selection;
    if (selection) this.activate(selection);
  }

  hideBoard(): void {
    this.visible = false;
  }

  currentSelection(): OfficeSelection | null {
    return this.selection ?? this.readSelection();
  }
}

function laneFor(status: CastWorker["status"]): BoardLaneId {
  switch (status) {
    case "queued":
    case "parked":
      return "queued";
    case "verifying":
      return "verifying";
    case "integrating":
      return "integrating";
    case "passed":
    case "done":
      return "done";
    case "held":
      return "held";
    case "waiting-on-you":
      return "waiting_on_you";
    default:
      return "working";
  }
}

function mirrorWorker(worker: CastWorker, roomId: OfficeWorkerRecord["roomId"]): OfficeWorkerRecord {
  return {
    agentId: worker.agentId,
    title: worker.taskTitle,
    roomId,
    stateLabel: worker.status,
    statusIcon: worker.health?.label ?? worker.status,
    priority: worker.elapsedSeconds,
    ...(worker.featureId ? { featureKey: worker.featureId } : {}),
    ...(worker.flagged === true ? { flagged: true } : {}),
  };
}

function healthKind(signal: HealthSignal): OfficeHealthSignal["kind"] | null {
  switch (signal.kind) {
    case "stuck_no_progress":
    case "loop_detected":
    case "rate_limited_backoff":
    case "allowance_window_wait":
    case "escalated_or_retrying":
      return signal.kind;
    default:
      return null;
  }
}

/**
 * Unified office surface inside SingleAppShell.
 * Task 162 floor plan feeds the Task 164 director, Task 163 cast feeds the projector port,
 * and Tasks 122–127 supply the shell tab, phase preset, board, health, inspector, and inbox.
 */
export class OfficeView {
  readonly projector: OfficeCastProjector;
  readonly cast: OfficeCastProjectorPortAdapter;
  readonly grid: FloorPlanWalkableGridPort;
  readonly director: TruthfulAnimationDirector;
  readonly coordinator: OfficeA11yCoordinator;
  private snapshot: OfficeCanonicalSnapshot | null = null;
  private scene: OfficeCastScene | null = null;
  private readonly phase = new PhaseTab();
  private readonly taskLane = new Map<string, BoardLaneId>();
  private readonly releaseHealth: () => void;
  private focusAgentId: string | null = null;

  constructor(private readonly mount: OfficeViewMount) {
    this.projector = new OfficeCastProjector(mount.plan);
    this.cast = new OfficeCastProjectorPortAdapter(this.projector);
    this.grid = new FloorPlanWalkableGridPort(mount.plan);
    this.director = new TruthfulAnimationDirector({ cast: this.cast, grid: this.grid });
    const camera: OfficeCameraPort = {
      panToAgent: (agentId) => {
        const seat = this.cast.project(agentId);
        if (seat) this.mount.camera.jumpToRoom(seat.truthfulRoomId);
      },
      setFocusRing: (agentId) => {
        this.focusAgentId = agentId;
      },
    };
    const tabs: CenterTabPort = {
      get activeTab() {
        return mount.layout.centerTab === "board" ? "board" : "office";
      },
      setTab: (tab) => {
        mount.layout.setCenterTab(tab);
      },
    };
    const focusMode: FocusModePort = {
      get active() {
        return mount.layout.focusMode;
      },
    };
    const board = new LiveBoardPort(
      mount.layout.centerTab === "board",
      (selection) => {
        const taskId = this.taskIdFor(selection.agentId);
        if (taskId) mount.board.activateCard(taskId, "click");
      },
      () => this.coordinatorSelection(),
    );
    this.coordinator = new OfficeA11yCoordinator({
      media: mount.media,
      director: this.director,
      phasePreset: this.phase,
      pressure: bindPressureHysteresisStateMachine(mount.pressure),
      tabs,
      board,
      pixi: mount.pixi,
      focusMode,
      camera,
      inspector: {
        open: (selection) => this.openInspector(selection),
      },
      inbox: {
        openFromCeoInbox: () => {
          mount.inbox.openManually();
        },
      },
    });
    this.releaseHealth = mount.health.subscribe((view) => {
      this.applyHealth(view);
    });
    this.applyPhase(mount.environment);
  }

  get focusedAgentId(): string | null {
    return this.focusAgentId;
  }

  start(): void {
    this.coordinator.start();
    this.director.setOfficeTabVisible(this.mount.layout.centerTab === "office");
  }

  stop(): void {
    this.releaseHealth();
    this.coordinator.stop();
  }

  applyPhase(environment: PhaseEnvironment): CenterWorkspaceTab {
    const applied = this.mount.presets.apply("build", environment);
    const tab: CenterWorkspaceTab = applied.center.primaryTab === "board" ? "board" : "office";
    this.phase.buildPhaseDefaultTab = tab;
    if (applied.center.primaryTab === "office" || applied.center.primaryTab === "board") {
      this.mount.layout.setCenterTab(applied.center.primaryTab);
    }
    if (applied.center.officePresentation === "static-seated") {
      this.coordinator.reducedMotion.setUserToggle(true);
    }
    return tab;
  }

  sync(snapshot: OfficeCanonicalSnapshot, nowMs: number): void {
    this.snapshot = snapshot;
    const scene = this.cast.publish(snapshot, nowMs);
    this.scene = scene;
    this.taskLane.clear();
    for (const seat of scene.seats) {
      this.taskLane.set(seat.agentId, laneFor(seat.status));
    }
    this.director.syncAllFromCast(nowMs);
    this.director.setOfficeTabVisible(this.mount.layout.centerTab === "office");
    const workers = scene.seats.flatMap((seat) => {
      const worker = snapshot.workers.find((entry) => entry.agentId === seat.agentId);
      return worker ? [mirrorWorker(worker, seat.roomId)] : [];
    });
    this.coordinator.setWorkers(workers, snapshot.inboxCards.filter((card) => card.actionable && !card.resolved).length);
  }

  applyHealth(view: HealthBoardView): void {
    const current = this.snapshot;
    if (!current) return;
    const byTask = new Map(view.workers.map((worker) => [worker.taskId, worker]));
    let changed = false;
    const workers = current.workers.map((worker) => {
      const health = byTask.get(worker.taskId);
      if (!health) return worker;
      const signal = health.signals.find((entry) => healthKind(entry) !== null);
      const kind = health.stuck ? "stuck_no_progress" : signal ? healthKind(signal) : null;
      if (!kind) return worker;
      changed = true;
      const label = signal?.label ?? kind;
      return { ...worker, health: { kind, label } };
    });
    if (!changed) return;
    this.sync({ ...current, workers }, view.nowMs);
  }

  click(target: OfficeClickTarget): InteractionEffect | null {
    const snapshot = this.snapshot;
    const scene = this.scene;
    if (!snapshot || !scene) return null;
    const controller = new OfficeInteractionController(scene, snapshot, {
      inspector: {
        open: (request) => {
          const worker = snapshot.workers.find((entry) => entry.agentId === request.agentId);
          this.openInspector({
            agentId: request.agentId,
            title: worker?.taskTitle ?? request.taskId,
            openedBy: "click",
          });
        },
      },
      inbox: {
        focusTopActionable: () => {
          this.mount.inbox.openManually();
        },
      },
      summaries: {
        openPool2() {
          /* pool summary stays on the cast interaction port */
        },
        openMergeQueue() {
          /* merge summary stays on the cast interaction port */
        },
        openShip() {
          /* ship summary stays on the cast interaction port */
        },
        openExternalIntake() {
          /* intake summary stays on the cast interaction port */
        },
      },
    });
    return controller.click(target);
  }

  setOrangeOverride(active: boolean): void {
    this.coordinator.orangeFallback.setUserOverride(active);
  }

  private taskIdFor(agentId: string): string | null {
    return this.snapshot?.workers.find((worker) => worker.agentId === agentId)?.taskId ?? null;
  }

  private coordinatorSelection(): OfficeSelection | null {
    return this.coordinator.mirror.snapshotSelection();
  }

  private openInspector(selection: OfficeSelection): void {
    const taskId = this.taskIdFor(selection.agentId);
    if (!taskId) return;
    const lane = this.taskLane.get(selection.agentId) ?? "working";
    this.mount.inspector.open({
      taskId,
      agentTag: `${selection.agentId} · ${selection.title}`,
      lane,
      openedBy: selection.openedBy === "keyboard" ? "enter" : "click",
    });
    this.coordinator.setSelection(selection);
  }
}

export function shellCenterTab(layout: ShellLayoutContext, tab: "office" | "board"): CenterTabId {
  layout.setCenterTab(tab);
  return layout.centerTab;
}
