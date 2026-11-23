import { CrossProjectGrantLeaseManager } from "./cross-project-grant-lease-manager.js";
import type { GlobalDbGrantStore } from "./types.js";
import {
  type BrokerPopoverSnapshot,
  type BrokerRequest,
  type ExecutionSlotRequest,
  type GrantIssueInput,
  type GrantIssueResult,
  type MachineCapacityLimits,
  type PacingCwndPort,
  type PriorityClass,
} from "./types.js";
import { MachineWideSlotCoordinator } from "./machine-wide-slot-coordinator.js";
import { ReservedInteractiveLanePerConnection } from "./reserved-interactive-lane.js";
import { WeightedFairQueueArbiter } from "./weighted-fair-queue-arbiter.js";

export interface ProjectClassHint {
  readonly projectId: string;
  readonly defaultClass: PriorityClass;
}

export class GlobalMultiProjectBroker {
  private readonly wfq = new WeightedFairQueueArbiter();
  private readonly grants: CrossProjectGrantLeaseManager;
  private readonly slots: MachineWideSlotCoordinator;
  private readonly interactiveLane: ReservedInteractiveLanePerConnection;
  private foregroundProjectId: string | null = null;
  private readonly projectHints = new Map<string, PriorityClass>();
  private readonly connectionLabels = new Map<string, string>();
  private readonly machineLimits: MachineCapacityLimits;

  constructor(store: GlobalDbGrantStore, pacing: PacingCwndPort, machineLimits: MachineCapacityLimits) {
    this.machineLimits = { ...machineLimits };
    this.grants = new CrossProjectGrantLeaseManager(store);
    this.slots = new MachineWideSlotCoordinator(machineLimits);
    this.interactiveLane = new ReservedInteractiveLanePerConnection(pacing);
  }

  registerProject(projectId: string, defaultClass: PriorityClass = "background"): void {
    this.projectHints.set(projectId, defaultClass);
  }

  setForegroundProject(projectId: string): void {
    if (this.foregroundProjectId && this.foregroundProjectId !== projectId) {
      const prevClass = this.projectHints.get(this.foregroundProjectId) ?? "foreground";
      if (prevClass === "foreground") {
        this.projectHints.set(this.foregroundProjectId, "background");
      }
    }
    this.foregroundProjectId = projectId;
    this.projectHints.set(projectId, "foreground");
  }

  enqueueProviderRequest(request: BrokerRequest): void {
    const priorityClass = this.resolvePriorityClass(request.projectId, request.priorityClass);
    this.wfq.enqueue({ ...request, priorityClass });
  }

  dispatchProviderTurn(nowMs: number): BrokerRequest | undefined {
    const fast = this.wfq.tryDispatchInteractiveFastLane(nowMs);
    if (fast?.connectionId && this.interactiveLane.canDispatchFastLane(fast.connectionId)) {
      this.interactiveLane.markDispatched(fast.connectionId);
      return fast;
    }
    if (fast?.connectionId) {
      this.wfq.enqueue(fast);
    }
    const next = this.wfq.dequeueNext(nowMs);
    if (next?.connectionId && next.priorityClass === "interactive") {
      this.interactiveLane.markDispatched(next.connectionId);
    }
    return next;
  }

  releaseProviderTurn(connectionId: string): void {
    this.interactiveLane.release(connectionId);
  }

  requestBudgetGrant(input: GrantIssueInput, priorityClass?: PriorityClass): GrantIssueResult {
    const cls = priorityClass ?? this.resolvePriorityClass(input.projectId, "foreground");
    return this.grants.requestGrant(input, cls);
  }

  reclaimExpiredGrants(nowMs: number): number {
    return this.grants.reclaimExpiredGrants(nowMs);
  }

  closeGrant(grantId: string, usedAmount: number, nowMs: number): number {
    return this.grants.closeGrant(grantId, usedAmount, nowMs);
  }

  acquireExecutionSlot(request: ExecutionSlotRequest) {
    const priorityClass = this.resolvePriorityClass(request.projectId, request.priorityClass);
    return this.slots.acquireExecutionSlot({ ...request, priorityClass });
  }

  leasePort(
    port: number,
    projectId: string,
    environment: string,
    nowMs: number,
    expiresAtMs: number | null = null,
  ) {
    return this.slots.leasePort(port, projectId, environment, nowMs, expiresAtMs);
  }

  setGovernorOrange(enabled: boolean): void {
    this.slots.setGovernorOrange(enabled);
  }

  registerConnectionLabel(connectionId: string, label: string): void {
    this.connectionLabels.set(connectionId, label);
  }

  popoverSnapshot(): BrokerPopoverSnapshot {
    const slotSnap = this.slots.snapshot();
    const connectionLines = [...this.connectionLabels.entries()].map(([connectionId, label]) => ({
      connectionId,
      summary: label,
    }));
    const machineRunSlots = `${slotSnap.pool2InUse}/${this.machineLimits.pool2WarmSlots} (${slotSnap.slotOwners.join(", ") || "idle"})`;
    return {
      foregroundProjectId: this.foregroundProjectId,
      connectionLines,
      machineRunSlots,
    };
  }

  wfqArbiter(): WeightedFairQueueArbiter {
    return this.wfq;
  }

  grantManager(): CrossProjectGrantLeaseManager {
    return this.grants;
  }

  slotCoordinator(): MachineWideSlotCoordinator {
    return this.slots;
  }

  private resolvePriorityClass(projectId: string, requested: PriorityClass): PriorityClass {
    if (requested === "interactive") return "interactive";
    if (this.foregroundProjectId === projectId) return "foreground";
    return this.projectHints.get(projectId) ?? requested;
  }
}