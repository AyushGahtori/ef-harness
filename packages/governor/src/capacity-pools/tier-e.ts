import { CapacityError, SecretTransferRefusedError, assertNonEmpty } from "./errors.js";

export type ExecutionLocality = "local" | "remote";

export interface ProvisionSlotRequest {
  readonly slotId: string;
  readonly locality: ExecutionLocality;
}

export interface ProvisionedSlot {
  readonly slotId: string;
  readonly backendSlotId: string;
  readonly locality: ExecutionLocality;
}

export interface SyncDiffRequest {
  readonly slot: ProvisionedSlot;
  readonly baseCommit: string;
  readonly patch: string;
  readonly secretsApproved: boolean;
  readonly secretMaterialPresent: boolean;
}

export interface SyncDiffResult {
  readonly synced: true;
  readonly bytes: number;
}

export interface ExecCommandRequest {
  readonly slot: ProvisionedSlot;
  readonly command: string;
  readonly timeoutMs: number;
  readonly networkPolicy: "deny" | "allowlist";
}

export interface ExecCommandResult {
  readonly execId: string;
  readonly exitCode: number;
  readonly output: string;
}

export interface OutputChunk {
  readonly execId: string;
  readonly stream: "stdout" | "stderr";
  readonly text: string;
}

export interface ArtifactSet {
  readonly execId: string;
  readonly paths: readonly string[];
}

export interface CostEstimate {
  readonly currency: "usd";
  readonly amount: number;
}

/**
 * Pluggable slot backend. v1 ships the local implementation.
 * A remote Tier E backend can replace it without rewriting the scheduler.
 */
export interface ExecutionSlotBackend {
  readonly locality: ExecutionLocality;
  provisionSlot(request: ProvisionSlotRequest): Promise<ProvisionedSlot>;
  syncDiff(request: SyncDiffRequest): Promise<SyncDiffResult>;
  execCommand(request: ExecCommandRequest): Promise<ExecCommandResult>;
  streamOutput(result: ExecCommandResult): AsyncIterable<OutputChunk>;
  collectArtifacts(result: ExecCommandResult): Promise<ArtifactSet>;
  releaseSlot(slot: ProvisionedSlot): Promise<void>;
  costEstimate(request: { readonly command: string; readonly locality: ExecutionLocality }): Promise<CostEstimate>;
}

export interface TierECycleRequest {
  readonly slotId: string;
  readonly baseCommit: string;
  readonly patch: string;
  readonly command: string;
  readonly timeoutMs: number;
  readonly secretsApproved: boolean;
  readonly secretMaterialPresent: boolean;
  readonly networkPolicy?: "deny" | "allowlist";
}

export interface TierECycleResult {
  readonly slot: ProvisionedSlot;
  readonly synced: SyncDiffResult;
  readonly exec: ExecCommandResult;
  readonly chunks: readonly OutputChunk[];
  readonly artifacts: ArtifactSet;
  readonly cost: CostEstimate;
}

const BACKEND_METHODS = [
  "provisionSlot",
  "syncDiff",
  "execCommand",
  "streamOutput",
  "collectArtifacts",
  "releaseSlot",
  "costEstimate",
] as const;

export function assertExecutionSlotBackend(backend: ExecutionSlotBackend): void {
  if (backend.locality !== "local" && backend.locality !== "remote") {
    throw new CapacityError("tier_e", "Execution backend locality must be local or remote");
  }
  for (const method of BACKEND_METHODS) {
    if (typeof backend[method] !== "function") {
      throw new CapacityError("tier_e", `ExecutionSlotBackend is missing ${method}`);
    }
  }
}

export function assertUsdCost(cost: CostEstimate): void {
  if (cost.currency !== "usd" || !Number.isFinite(cost.amount) || cost.amount < 0) {
    throw new CapacityError("tier_e", "Execution cost must be a non-negative usd amount");
  }
}

/**
 * Tier E contract used by post-v1 remote sandboxes.
 * The cycle is provision, sync, exec, stream, collect, cost, release.
 * Secret bytes are refused before sync unless the developer approved that target.
 */
export class TierERemoteExecutionInterface {
  constructor(private readonly backend: ExecutionSlotBackend) {
    assertExecutionSlotBackend(backend);
  }

  get locality(): ExecutionLocality {
    return this.backend.locality;
  }

  async runCycle(request: TierECycleRequest): Promise<TierECycleResult> {
    assertNonEmpty(request.slotId, "slotId");
    assertNonEmpty(request.command, "command");
    const slot = await this.backend.provisionSlot({
      slotId: request.slotId,
      locality: this.backend.locality,
    });
    try {
      if (request.secretMaterialPresent && !request.secretsApproved) {
        throw new SecretTransferRefusedError();
      }
      const synced = await this.backend.syncDiff({
        slot,
        baseCommit: request.baseCommit,
        patch: request.patch,
        secretsApproved: request.secretsApproved,
        secretMaterialPresent: request.secretMaterialPresent,
      });
      const exec = await this.backend.execCommand({
        slot,
        command: request.command,
        timeoutMs: request.timeoutMs,
        networkPolicy: request.networkPolicy ?? (this.backend.locality === "remote" ? "deny" : "allowlist"),
      });
      const chunks: OutputChunk[] = [];
      for await (const chunk of this.backend.streamOutput(exec)) chunks.push(chunk);
      const artifacts = await this.backend.collectArtifacts(exec);
      const cost = await this.backend.costEstimate({
        command: request.command,
        locality: this.backend.locality,
      });
      assertUsdCost(cost);
      return { slot, synced, exec, chunks, artifacts, cost };
    } finally {
      await this.backend.releaseSlot(slot);
    }
  }
}

export class LocalExecutionSlotBackend implements ExecutionSlotBackend {
  readonly locality = "local" as const;
  provisionCount = 0;
  private nextExec = 1;
  private readonly live = new Set<string>();

  async provisionSlot(request: ProvisionSlotRequest): Promise<ProvisionedSlot> {
    this.provisionCount += 1;
    const slot: ProvisionedSlot = {
      slotId: request.slotId,
      backendSlotId: `local-${request.slotId}`,
      locality: "local",
    };
    this.live.add(slot.backendSlotId);
    return slot;
  }

  async syncDiff(request: SyncDiffRequest): Promise<SyncDiffResult> {
    this.require(request.slot);
    if (request.secretMaterialPresent && !request.secretsApproved) {
      throw new SecretTransferRefusedError();
    }
    return { synced: true, bytes: request.patch.length };
  }

  async execCommand(request: ExecCommandRequest): Promise<ExecCommandResult> {
    this.require(request.slot);
    const execId = `exec-${this.nextExec}`;
    this.nextExec += 1;
    return { execId, exitCode: 0, output: request.command };
  }

  async *streamOutput(result: ExecCommandResult): AsyncIterable<OutputChunk> {
    yield { execId: result.execId, stream: "stdout", text: result.output };
  }

  async collectArtifacts(result: ExecCommandResult): Promise<ArtifactSet> {
    return { execId: result.execId, paths: [] };
  }

  async releaseSlot(slot: ProvisionedSlot): Promise<void> {
    this.live.delete(slot.backendSlotId);
  }

  async costEstimate(): Promise<CostEstimate> {
    return { currency: "usd", amount: 0 };
  }

  private require(slot: ProvisionedSlot): void {
    if (!this.live.has(slot.backendSlotId)) {
      throw new CapacityError("tier_e", `Local slot ${slot.slotId} is not provisioned`);
    }
  }
}
