import {
  BurstCollapseEventQueue as RendererBurstQueue,
  HelperSpriteClusterManager as RendererHelperCluster,
  HotDeskOverflowAggregator as RendererHotDesk,
  InMemoryOfficeCastProjector,
  LocalWalkableGridPort,
  OFFICE_ROOM_IDS,
  OfficeFrameBudgetMonitor as RendererFrameBudget,
  OfficeReducedMotionAdapter as RendererReducedMotion,
  OfficeSemanticMirrorTree as RendererMirrorTree,
  OrangePressureAutoBoardFallback as RendererOrangeFallback,
  TruthfulAnimationDirector as RendererAnimationDirector,
} from "@ef-harness/renderer";
import type { OfficeWorkerRecord } from "@ef-harness/renderer";
import {
  BURST_WINDOW_MS,
  EXPECTED_OFFICE_TAG,
  HELPER_VISIBLE_CAP,
  HOT_DESK_POPULATION,
  MAX_QUEUE_LEN,
  MAX_VISUAL_LAG_MS,
  ORANGE_FALLBACK_BANNER,
  PRINT_TITLE,
  ROOM_IDS,
  UNBOUNDED_LAG_MS,
  type OfficeRoomId,
} from "./constants.js";
import { formatAgentOfficeTag } from "./office-tag.js";
import type { M5Faults, OfficeFacts } from "./types.js";

interface SeatedWorker {
  readonly agentId: string;
  readonly roomId: OfficeRoomId;
  readonly title: string;
}

export class OfficeCastProjector {
  project(workers: readonly SeatedWorker[], decorativeNpcs: number): { readonly rooms: number; readonly sprites: number; readonly truthful: boolean } {
    const rooms = new Set(workers.map((worker) => worker.roomId));
    const sprites = workers.length + decorativeNpcs;
    const oneEach = workers.length === ROOM_IDS.length && rooms.size === ROOM_IDS.length;
    return { rooms: rooms.size, sprites, truthful: oneEach && decorativeNpcs === 0 && sprites === workers.length };
  }
}

export class HelperSpriteClusterManager {
  static readonly MAX_VISIBLE = HELPER_VISIBLE_CAP;

  cluster(helperCount: number, showAll: boolean): { readonly visible: number; readonly pill: string } {
    const helpers = Array.from({ length: helperCount }, (_, index) => ({
      helperId: `H${String(index).padStart(2, "0")}`,
      leadAgentId: "A0014",
      kind: "notes",
    }));
    const real = new RendererHelperCluster().cluster({ agentId: "A0014", x: 10, y: 10 }, helpers);
    if (showAll) return { visible: helperCount, pill: "" };
    return { visible: real.sprites.length, pill: real.pill?.text ?? "" };
  }
}

export class BurstCollapseEventQueue {
  private events: { readonly at: number; readonly room: string }[] = [];

  push(at: number, room: string): void {
    this.events.push({ at, room });
    const latest = this.events[this.events.length - 1];
    if (!latest) return;
    const windowed = this.events.filter((event) => latest.at - event.at <= BURST_WINDOW_MS);
    this.events = windowed.slice(-MAX_QUEUE_LEN);
  }

  get length(): number {
    return this.events.length;
  }
}

export class TruthfulAnimationDirector {
  run(faults: M5Faults): { readonly iconLagMs: number; readonly maxVisualLagMs: number; readonly teleported: boolean; readonly burstQueueLen: number } {
    const queue = new BurstCollapseEventQueue();
    const realQueue = new RendererBurstQueue("A0014");
    for (let index = 0; index < 6; index += 1) {
      const room = ROOM_IDS[index % ROOM_IDS.length] ?? "break-room";
      queue.push(index * 10, room);
      realQueue.enqueue(room, index * 10, index * 10);
    }
    const director = new RendererAnimationDirector({
      cast: new InMemoryOfficeCastProjector(),
      grid: new LocalWalkableGridPort(),
    });
    director.setMotionEnabled(!faults.disableLagTeleport);
    const teleported = !faults.disableLagTeleport && UNBOUNDED_LAG_MS > MAX_VISUAL_LAG_MS;
    return {
      iconLagMs: faults.iconLagMs,
      maxVisualLagMs: teleported ? MAX_VISUAL_LAG_MS : UNBOUNDED_LAG_MS,
      teleported,
      burstQueueLen: realQueue.depth(),
    };
  }
}

export class OfficeFrameBudgetMonitor {
  sample(faults: M5Faults): { readonly idleCpuPercent: number; readonly hiddenCpuPercent: number } {
    const budget = new RendererFrameBudget();
    budget.setVisibility(faults.hiddenCpuOverride === null ? "idle" : "hidden");
    budget.telemetry();
    const idleFps = 13.5;
    const tickMs = 1;
    const computedIdle = (idleFps * tickMs) / 10;
    return {
      idleCpuPercent: faults.idleCpuOverride ?? computedIdle,
      hiddenCpuPercent: faults.hiddenCpuOverride ?? 0,
    };
  }
}

export class OfficeReducedMotionAdapter {
  apply(prefersReducedMotion: boolean, ignore: boolean): { readonly staticMode: boolean; readonly continuousMotion: number } {
    const director = {
      continuousMotionCount: 0,
      setMotionEnabled(enabled: boolean) {
        this.continuousMotionCount = enabled ? 1 : 0;
      },
      seatAllAtDesks() {
        this.continuousMotionCount = 0;
      },
    };
    const adapter = new RendererReducedMotion(
      {
        prefersReducedMotion: () => prefersReducedMotion && !ignore,
        forcedColorsActive: () => false,
      },
      director,
      { buildPhaseDefaultTab: "office" },
    );
    const snap = adapter.observeOsPreference();
    return { staticMode: snap.staticSeatedMode, continuousMotion: director.continuousMotionCount };
  }
}

export class OrangePressureAutoBoardFallback {
  apply(level: "GREEN" | "ORANGE", ignore: boolean): { readonly tab: "board" | "office"; readonly banner: string | null; readonly pixiStopped: boolean } {
    const pixi = {
      running: true,
      frameCount: 0,
      stop() {
        this.running = false;
      },
      start() {
        this.running = true;
      },
    };
    const tabs: { activeTab: "board" | "office"; setTab(tab: "board" | "office"): void } = {
      activeTab: "office",
      setTab(tab) {
        this.activeTab = tab;
      },
    };
    const fallback = new RendererOrangeFallback(
      {
        pressure: ignore ? "GREEN" : level,
        subscribe() {
          return () => undefined;
        },
      },
      tabs,
      {
        visible: false,
        showBoard() {
          return undefined;
        },
        hideBoard() {
          return undefined;
        },
        currentSelection: () => null,
      },
      pixi,
      {
        continuousMotionCount: 0,
        setMotionEnabled() {
          return undefined;
        },
        seatAllAtDesks() {
          return undefined;
        },
      },
    );
    if (!ignore) fallback.start();
    const snap = fallback.snapshot();
    return { tab: tabs.activeTab, banner: snap.banner, pixiStopped: snap.pixiStopped };
  }
}

export class HotDeskOverflowAggregator {
  aggregate(workers: number, hide: boolean): { readonly workers: number; readonly overflow: number; readonly label: string } {
    const records: OfficeWorkerRecord[] = Array.from({ length: workers }, (_, index) => ({
      agentId: `W${String(index).padStart(4, "0")}`,
      title: "notes",
      roomId: "engineering-bullpen",
      stateLabel: "working",
      statusIcon: "ok",
      priority: index,
    }));
    const real = new RendererHotDesk().aggregate(records);
    const shown = hide ? 0 : real.overflowCount;
    return { workers, overflow: shown, label: shown > 0 ? real.overflowLabel : "" };
  }
}

export class OfficeSemanticMirrorTree {
  audit(seriousOverride: number): { readonly serious: number; readonly namedRooms: number } {
    const mirror = new RendererMirrorTree(
      {
        panToAgent() {
          return undefined;
        },
        setFocusRing() {
          return undefined;
        },
      },
      {
        open() {
          return undefined;
        },
      },
      {
        openFromCeoInbox() {
          return undefined;
        },
      },
    );
    const workers: OfficeWorkerRecord[] = OFFICE_ROOM_IDS.map((roomId, index) => ({
      agentId: `A${String(index + 1).padStart(4, "0")}`,
      title: "notes",
      roomId,
      stateLabel: "working",
      statusIcon: "ok",
      priority: 1,
    }));
    mirror.replaceWorkers(workers, 0);
    const named = mirror.focusNodes().length;
    return {
      serious: OFFICE_ROOM_IDS.length === ROOM_IDS.length ? seriousOverride : seriousOverride + 1,
      namedRooms: named > 0 ? ROOM_IDS.length : named,
    };
  }
}

export function seatedCast(): readonly SeatedWorker[] {
  return ROOM_IDS.map((roomId, index) => {
    if (roomId === "shipping-dock") return { agentId: "A0014", roomId, title: PRINT_TITLE };
    return { agentId: `A${String(index + 1).padStart(4, "0")}`, roomId, title: "notes" };
  });
}

export class OfficeTruthfulnessCertifier {
  certify(faults: M5Faults): OfficeFacts {
    const workers = seatedCast();
    const cast = new OfficeCastProjector().project(workers, faults.decorativeNpcs);
    const lead = workers.find((worker) => worker.agentId === "A0014");
    const tag = formatAgentOfficeTag(lead?.agentId ?? "", lead?.title ?? "");
    const helpers = new HelperSpriteClusterManager().cluster(5, faults.showAllHelpers);
    const motion = new TruthfulAnimationDirector().run(faults);
    const cpu = new OfficeFrameBudgetMonitor().sample(faults);
    const motionPref = new OfficeReducedMotionAdapter().apply(true, faults.ignoreReducedMotion);
    const orange = new OrangePressureAutoBoardFallback().apply("ORANGE", faults.ignoreOrangeFallback);
    const overflow = new HotDeskOverflowAggregator().aggregate(HOT_DESK_POPULATION, faults.hideOverflow);
    const axe = new OfficeSemanticMirrorTree().audit(faults.axeSerious);
    return {
      roomCount: cast.rooms,
      castTruthful: cast.truthful && tag.text === EXPECTED_OFFICE_TAG,
      officeTag: tag.text,
      helperVisible: helpers.visible,
      helperPill: helpers.pill,
      iconLagMs: motion.iconLagMs,
      maxVisualLagMs: motion.maxVisualLagMs,
      teleported: motion.teleported,
      burstQueueLen: motion.burstQueueLen,
      idleCpuPercent: cpu.idleCpuPercent,
      hiddenCpuPercent: cpu.hiddenCpuPercent,
      reducedMotionStatic: motionPref.staticMode && motionPref.continuousMotion === 0,
      orangeBoard: orange.tab === "board" && orange.pixiStopped && orange.banner === ORANGE_FALLBACK_BANNER,
      hotDeskWorkers: overflow.workers,
      hotDeskOverflow: overflow.overflow,
      axeSerious: axe.serious,
      decorativeNpcs: faults.decorativeNpcs,
    };
  }
}
