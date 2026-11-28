import type { LoadedFloorPlan } from "../renderer/types.js";
import { AgentLabelAndDeskPinLayer } from "./agent-label-and-desk-pin-layer.js";
import { mapStatusToBoardLane } from "./board-lane.js";
import { resolveConnection } from "./connection-pins.js";
import { buildFeaturePodPlinths } from "./feature-pod-labels.js";
import { formatAgentOfficeTag } from "./format-agent-office-tag.js";
import { HelperSpriteClusterManager } from "./helper-sprite-cluster-manager.js";
import { overheadIconFor } from "./overhead-icons.js";
import { PaperAndParcelFlowVisuals } from "./paper-and-parcel-flow-visuals.js";
import { rankOutfitFor } from "./rank-outfits.js";
import { clampRigCount, deskAnchor, QA_VERIFICATION_LAB, roomForWorker } from "./rooms.js";
import {
  ROOM_IDS,
  type OfficeCanonicalSnapshot,
  type OfficeCastScene,
  type OfficeHelperRecord,
  type OfficeViewState,
  type OfficeWorkerRecord,
  type RoomId,
  type SeatedCastMember,
  type TestRigVisual,
} from "./types.js";

function compareWorkers(roomId: RoomId, a: OfficeWorkerRecord, b: OfficeWorkerRecord): number {
  if (roomId === "engineering-bullpen") {
    const feature = (a.featureId ?? "").localeCompare(b.featureId ?? "");
    if (feature !== 0) return feature;
  }
  return a.agentId.localeCompare(b.agentId);
}

function phantomCount(
  snapshot: OfficeCanonicalSnapshot,
  seats: readonly SeatedCastMember[],
  helperIds: readonly string[],
): number {
  const taskIds = new Set(snapshot.workers.map((worker) => worker.taskId));
  const agentIds = new Set(snapshot.workers.map((worker) => worker.agentId));
  const knownHelpers = new Set(
    snapshot.workers.flatMap((worker) => (worker.helpers ?? []).map((helper) => helper.helperId)),
  );
  let phantoms = 0;
  for (const seat of seats) {
    if (!taskIds.has(seat.taskId) || !agentIds.has(seat.agentId)) phantoms += 1;
  }
  if (seats.length !== snapshot.workers.length) {
    phantoms += Math.abs(seats.length - snapshot.workers.length);
  }
  for (const helperId of helperIds) {
    if (!knownHelpers.has(helperId)) phantoms += 1;
  }
  const visibleCap = snapshot.workers.length * HelperSpriteClusterManager.MAX_VISIBLE;
  if (helperIds.length > visibleCap) phantoms += helperIds.length - visibleCap;
  return phantoms;
}

/**
 * Projects live state.db workers onto the 11-room floor plan.
 * An empty snapshot produces an empty office: no decorative NPCs and no typing.
 */
export class OfficeCastProjector {
  private readonly labels = new AgentLabelAndDeskPinLayer();
  private readonly helpers = new HelperSpriteClusterManager();
  private readonly flows = new PaperAndParcelFlowVisuals();

  constructor(private readonly plan: LoadedFloorPlan) {}

  project(snapshot: OfficeCanonicalSnapshot, view: OfficeViewState = { zoom: 1 }): OfficeCastScene {
    const seats = this.seatWorkers(snapshot);
    const layer = this.labels.build(seats, view);
    const helpersByLead = new Map<string, readonly OfficeHelperRecord[]>();
    for (const worker of snapshot.workers) {
      helpersByLead.set(worker.agentId, worker.helpers ?? []);
    }
    const clustered = this.helpers.clusterAll(seats, helpersByLead);
    const flows = this.flows.project(snapshot);
    const pods = buildFeaturePodPlinths(seats, snapshot.features);
    const rigs = this.testRigs(snapshot, seats);
    const idle = snapshot.workers.length === 0 && flows.tray.clean && flows.parcel === null;
    return {
      rooms: ROOM_IDS,
      seats,
      helpers: clustered.sprites,
      helperPills: clustered.pills,
      labels: layer.labels,
      pins: layer.pins,
      pods,
      rigs,
      tray: flows.tray,
      parcel: flows.parcel,
      idle,
      phantomSpriteCount: phantomCount(
        snapshot,
        seats,
        clustered.sprites.map((sprite) => sprite.helperId),
      ),
      walkQueues: [],
    };
  }

  private seatWorkers(snapshot: OfficeCanonicalSnapshot): SeatedCastMember[] {
    const grouped = new Map<RoomId, OfficeWorkerRecord[]>();
    for (const worker of snapshot.workers) {
      const roomId = roomForWorker(worker);
      const list = grouped.get(roomId);
      if (list) list.push(worker);
      else grouped.set(roomId, [worker]);
    }
    const rigCapacity = clampRigCount(snapshot.pool2SlotCapacity);
    const seats: SeatedCastMember[] = [];
    for (const [roomId, workers] of grouped) {
      const ordered = workers.slice().sort((a, b) => compareWorkers(roomId, a, b));
      ordered.forEach((worker, index) => {
        const anchor = deskAnchor(this.plan, roomId, index);
        const rigIndex = roomId === QA_VERIFICATION_LAB && index < rigCapacity ? index : null;
        seats.push({
          source: "state.db",
          agentId: worker.agentId,
          taskId: worker.taskId,
          roomId,
          deskIndex: index,
          rigIndex,
          x: anchor.x,
          y: anchor.y,
          outfit: rankOutfitFor(worker),
          tag: formatAgentOfficeTag(worker.agentId, worker.taskTitle),
          pin: resolveConnection(worker.connection),
          overhead: {
            icon: overheadIconFor(worker),
            frameLagMs: 0,
            delayedByWalk: false,
          },
          boardLane: mapStatusToBoardLane(worker.status),
          flagged: worker.flagged === true,
          status: worker.status,
          featureId: worker.featureId ?? null,
        });
      });
    }
    return seats.sort((a, b) => a.agentId.localeCompare(b.agentId));
  }

  private testRigs(snapshot: OfficeCanonicalSnapshot, seats: readonly SeatedCastMember[]): TestRigVisual[] {
    const capacity = clampRigCount(snapshot.pool2SlotCapacity);
    const rigs: TestRigVisual[] = [];
    for (let index = 0; index < capacity; index += 1) {
      const occupant = seats.find((seat) => seat.roomId === QA_VERIFICATION_LAB && seat.rigIndex === index);
      const anchor = deskAnchor(this.plan, QA_VERIFICATION_LAB, index);
      rigs.push({
        roomId: QA_VERIFICATION_LAB,
        rigIndex: index,
        glowing: occupant !== undefined,
        occupantAgentId: occupant?.agentId ?? null,
        x: anchor.x,
        y: anchor.y,
      });
    }
    return rigs;
  }
}
