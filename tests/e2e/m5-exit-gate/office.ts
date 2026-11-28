import {
  BULLPEN_VISIBLE_DESK_CAP,
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
} from "./constants.ts";
import { formatAgentOfficeTag } from "./office-tag.ts";
import type { M5Faults, OfficeFacts } from "./types.ts";

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
    const cap = showAll ? helperCount : HelperSpriteClusterManager.MAX_VISIBLE;
    const visible = Math.min(helperCount, cap);
    const hidden = helperCount - visible;
    return { visible, pill: hidden > 0 ? `+${hidden}` : "" };
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
    for (let index = 0; index < 6; index += 1) {
      const room = ROOM_IDS[index % ROOM_IDS.length] ?? "break-room";
      queue.push(index * 10, room);
    }
    const teleported = !faults.disableLagTeleport && UNBOUNDED_LAG_MS > MAX_VISUAL_LAG_MS;
    return {
      iconLagMs: faults.iconLagMs,
      maxVisualLagMs: teleported ? MAX_VISUAL_LAG_MS : UNBOUNDED_LAG_MS,
      teleported,
      burstQueueLen: queue.length,
    };
  }
}

export class OfficeFrameBudgetMonitor {
  sample(faults: M5Faults): { readonly idleCpuPercent: number; readonly hiddenCpuPercent: number } {
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
    const staticMode = prefersReducedMotion && !ignore;
    return { staticMode, continuousMotion: staticMode ? 0 : 1 };
  }
}

export class OrangePressureAutoBoardFallback {
  apply(level: "GREEN" | "ORANGE", ignore: boolean): { readonly tab: "board" | "office"; readonly banner: string | null; readonly pixiStopped: boolean } {
    if (level === "ORANGE" && !ignore) {
      return { tab: "board", banner: ORANGE_FALLBACK_BANNER, pixiStopped: true };
    }
    return { tab: "office", banner: null, pixiStopped: false };
  }
}

export class HotDeskOverflowAggregator {
  aggregate(workers: number, hide: boolean): { readonly workers: number; readonly overflow: number; readonly label: string } {
    const overflow = Math.max(0, workers - BULLPEN_VISIBLE_DESK_CAP);
    const shown = hide ? 0 : overflow;
    return { workers, overflow: shown, label: shown > 0 ? `+${shown}` : "" };
  }
}

export class OfficeSemanticMirrorTree {
  audit(seriousOverride: number): { readonly serious: number; readonly namedRooms: number } {
    const named = ROOM_IDS.map((roomId) => ({ roomId, name: roomId.replaceAll("-", " ") })).filter((node) => node.name.trim().length > 0);
    return { serious: named.length === ROOM_IDS.length ? seriousOverride : seriousOverride + 1, namedRooms: named.length };
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
