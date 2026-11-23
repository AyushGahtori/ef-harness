import { DeterministicCodemodRunner } from "./deterministic-codemod-runner.js";
import { MaintenanceWindowDrainer } from "./maintenance-window-drainer.js";
import { buildSweepPlanPreview, requiresApproval } from "./plan-preview.js";
import { normalizePrefixes, scopeToGlobs } from "./path-prefix.js";
import type { SweepOrchestratorPorts } from "./ports.js";
import { SweepLeaseCoordinator } from "./sweep-lease-coordinator.js";
import { partitionTailShards } from "./tail-shards.js";
import type { SweepOrchestratorInput, SweepOrchestratorResult } from "./types.js";
import { SWEEP_BRANCH_PREFIX } from "./types.js";

export type SweepOrchestratorOptions = {
  readonly ports: SweepOrchestratorPorts;
};

export type RunSweepInput = SweepOrchestratorInput & {
  readonly now: number;
  readonly approved?: boolean;
  readonly isCancelled?: () => boolean;
  readonly onProgress?: Parameters<MaintenanceWindowDrainer["drainUntilGranted"]>[0]["onProgress"];
};

export class SweepOrchestrator {
  private readonly ports: SweepOrchestratorPorts;
  private readonly coordinator: SweepLeaseCoordinator;
  private readonly drainer: MaintenanceWindowDrainer;
  private readonly codemods: DeterministicCodemodRunner;
  private aborted = false;

  constructor(options: SweepOrchestratorOptions) {
    this.ports = options.ports;
    this.coordinator = new SweepLeaseCoordinator({ leases: options.ports.leases });
    this.drainer = new MaintenanceWindowDrainer({
      leases: options.ports.leases,
      tasks: options.ports.tasks,
    });
    this.codemods = new DeterministicCodemodRunner({
      sandbox: options.ports.sandbox,
      codemods: options.ports.codemods,
    });
  }

  buildPreview(input: RunSweepInput) {
    const table = input.plan.persistedNamesKept[0];
    return buildSweepPlanPreview(input.label, input.plan, table ? { persistedTable: table } : undefined);
  }

  async run(input: RunSweepInput): Promise<SweepOrchestratorResult> {
    const preview = this.buildPreview(input);
    const needsApproval = requiresApproval(preview, input.plan.persistedNamesKept.length > 0);
    if (needsApproval && input.approved !== true) {
      return { ok: false, phase: "lease", detail: preview.summaryLine };
    }

    let leaseId = input.sweepId;
    try {
      const intent = this.coordinator.acquireIntent({
        leaseId,
        sweepTask: input.sweepId,
        scope: input.scope,
        now: input.now,
      });
      leaseId = intent.leaseId;
      const prefixes = normalizePrefixes(scopeToGlobs(input.scope));
      const drainInput = {
        leaseId,
        sweepTask: input.sweepId,
        sweepLabel: input.label,
        leasePrefixes: prefixes,
        isCancelled: () => (input.isCancelled?.() ?? false) || this.aborted,
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
      };
      const drain = await this.drainer.drainUntilGranted(drainInput);
      if (!drain.ok) {
        return { ok: false, phase: drain.reason === "cancelled" ? "aborted" : "drain", detail: drain.reason };
      }

      const branchInfo = await this.ports.worktrees.ensureSweepBranch({
        slug: input.slug,
        integrationHead: input.integrationHead,
      });
      const branch = branchInfo.branch;
      if (!branch.startsWith(SWEEP_BRANCH_PREFIX)) {
        return { ok: false, phase: "branch", detail: "sweep branch must use harness/s/<slug>" };
      }

      for (const step of input.plan.mechanicalSteps) {
        if (input.isCancelled?.()) {
          this.abortCleanup(leaseId, input.slug);
          return { ok: false, phase: "aborted", detail: "STOP" };
        }
        const result = await this.codemods.runStep(branchInfo.worktreePath, step);
        if (!result.ok) {
          this.abortCleanup(leaseId, input.slug);
          return { ok: false, phase: "codemod", detail: result.detail };
        }
        const leftover = await this.ports.safety?.runLeftoverScan?.(branch);
        if (leftover && !leftover.ok) {
          this.abortCleanup(leaseId, input.slug);
          return { ok: false, phase: "codemod", detail: "leftover scan failed after codemod pass" };
        }
      }

      const shards = partitionTailShards(input.plan.tailPaths);
      const regression = await this.ports.safety?.runRegressionGate?.(branch);
      if (regression && !regression.ok) {
        this.abortCleanup(leaseId, input.slug);
        return { ok: false, phase: "codemod", detail: "regression gate failed before land" };
      }

      const landed =
        regression?.ok === true
          ? (
              await this.ports.refs.casUpdateRef({
                ref: "harness/integration",
                newSha: input.integrationHead,
                message: `EF-Sweep: ${input.sweepId}`,
              })
            ).updated
          : false;

      this.coordinator.release(leaseId);
      return { ok: true, branch, shards, landed };
    } catch (error) {
      this.coordinator.release(leaseId);
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, phase: "lease", detail };
    }
  }

  stop(): void {
    this.aborted = true;
  }

  private abortCleanup(leaseId: string, slug: string): void {
    this.coordinator.release(leaseId);
    void this.ports.worktrees.discardSweepBranch(slug);
  }
}