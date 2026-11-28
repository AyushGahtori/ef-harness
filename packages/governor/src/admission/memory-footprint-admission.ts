import type { LearnedFootprintStore } from "./learned-footprint-store.js";
import {
  DISK_EMERGENCY_BYTES,
  DISK_PAUSE_BYTES,
  HEAVY_LANE_PRIORITY_WEIGHT,
  safetyReserveMb,
} from "./thresholds.js";
import {
  isHeavyCommandClass,
  type CommandClass,
  type HeavyLaneRole,
  type PressureLevel,
} from "./types.js";

export interface AdmissionResources {
  readonly availRamMb: number;
  readonly totalRamMb: number;
  readonly availCommitMb: number;
  readonly pressure: PressureLevel;
  readonly lowMemoryNotification: boolean;
  readonly projectDiskFreeBytes: number;
  readonly appDataDiskFreeBytes: number;
}

export interface AdmissionRequest extends AdmissionResources {
  readonly id: string;
  readonly projectId: string;
  readonly commandClass: CommandClass;
  readonly role: HeavyLaneRole;
}

export type AdmissionDecision =
  | {
      readonly kind: "admit";
      readonly id: string;
      readonly predictedMb: number;
      readonly floor: boolean;
      readonly reason: string;
    }
  | {
      readonly kind: "queue";
      readonly id: string;
      readonly predictedMb: number;
      readonly reason: string;
    }
  | {
      readonly kind: "halt";
      readonly id: string;
      readonly predictedMb: number;
      readonly reason: string;
    };

interface TrackedJob {
  readonly id: string;
  readonly projectId: string;
  readonly commandClass: CommandClass;
  readonly role: HeavyLaneRole;
  readonly predictedMb: number;
  readonly sequence: number;
}

/**
 * Admits a command only when predicted p90 RAM fits in free RAM minus the
 * safety reserve and in remaining commit. Otherwise the command is queued
 * while another job is running. A single forward-progress slot can still
 * start when the machine is idle, not RED, and disk is at least 5 GB.
 */
export class MemoryFootprintAdmission {
  private readonly running = new Map<string, TrackedJob>();
  private readonly queued: TrackedJob[] = [];
  private sequence = 0;

  constructor(private readonly footprints: LearnedFootprintStore) {}

  get runningCount(): number {
    return this.running.size;
  }

  get queuedIds(): readonly string[] {
    return this.queued.map((job) => job.id);
  }

  request(input: AdmissionRequest): AdmissionDecision {
    if (this.running.has(input.id) || this.queued.some((job) => job.id === input.id)) {
      throw new Error(`Admission id ${input.id} is already tracked`);
    }
    const predictedMb = this.footprints.predictionMb(input.projectId, input.commandClass);
    const job: TrackedJob = {
      id: input.id,
      projectId: input.projectId,
      commandClass: input.commandClass,
      role: input.role,
      predictedMb,
      sequence: this.sequence,
    };
    this.sequence += 1;
    const decision = this.classify(job, input);
    if (decision.kind === "admit") this.running.set(job.id, job);
    else if (decision.kind === "queue") this.queued.push(job);
    return decision;
  }

  complete(id: string, resources: AdmissionResources): readonly AdmissionDecision[] {
    if (!this.running.delete(id)) {
      throw new Error(`No running admission ${id} to complete`);
    }
    return this.pump(resources);
  }

  reevaluate(resources: AdmissionResources): readonly AdmissionDecision[] {
    return this.pump(resources);
  }

  private pump(resources: AdmissionResources): AdmissionDecision[] {
    const admitted: AdmissionDecision[] = [];
    while (this.queued.length > 0) {
      const next = this.bestQueued();
      if (!next) break;
      const decision = this.classify(next, resources);
      if (decision.kind !== "admit") break;
      const index = this.queued.findIndex((job) => job.id === next.id);
      if (index >= 0) this.queued.splice(index, 1);
      this.running.set(next.id, next);
      admitted.push(decision);
    }
    return admitted;
  }

  private bestQueued(): TrackedJob | null {
    const ranked = [...this.queued].sort((left, right) => {
      const byWeight = HEAVY_LANE_PRIORITY_WEIGHT[right.role] - HEAVY_LANE_PRIORITY_WEIGHT[left.role];
      if (byWeight !== 0) return byWeight;
      return left.sequence - right.sequence;
    });
    return ranked[0] ?? null;
  }

  private classify(job: TrackedJob, resources: AdmissionResources): AdmissionDecision {
    const diskFree = Math.min(resources.projectDiskFreeBytes, resources.appDataDiskFreeBytes);
    const halted =
      resources.pressure === "RED" ||
      resources.lowMemoryNotification ||
      diskFree < DISK_EMERGENCY_BYTES;
    if (halted) {
      return {
        kind: "halt",
        id: job.id,
        predictedMb: job.predictedMb,
        reason: "halted: new execution launches are stopped",
      };
    }
    const reserve = safetyReserveMb(resources.totalRamMb);
    const ramFits = resources.availRamMb - reserve >= job.predictedMb;
    const commitFits = resources.availCommitMb >= job.predictedMb;
    const fits = ramFits && commitFits;
    const heavy = isHeavyCommandClass(job.commandClass);
    const diskPaused = diskFree < DISK_PAUSE_BYTES;
    if (diskPaused) {
      return {
        kind: "queue",
        id: job.id,
        predictedMb: job.predictedMb,
        reason: "queued: disk headroom is below 5 GB",
      };
    }
    if (fits) {
      if (resources.pressure === "ORANGE" && heavy && this.running.size > 0) {
        return {
          kind: "queue",
          id: job.id,
          predictedMb: job.predictedMb,
          reason: "queued: waiting before spawning a heavy job under orange pressure",
        };
      }
      return {
        kind: "admit",
        id: job.id,
        predictedMb: job.predictedMb,
        floor: false,
        reason: "admitted",
      };
    }
    if (this.running.size === 0) {
      return {
        kind: "admit",
        id: job.id,
        predictedMb: job.predictedMb,
        floor: true,
        reason: "admitted: forward-progress floor",
      };
    }
    const commitBlocked = ramFits && !commitFits;
    return {
      kind: "queue",
      id: job.id,
      predictedMb: job.predictedMb,
      reason: commitBlocked
        ? "queued: commit headroom is insufficient while another job is running"
        : "queued: predicted footprint does not fit while another job is running",
    };
  }
}
