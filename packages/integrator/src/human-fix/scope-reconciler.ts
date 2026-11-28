import { ACCEPTED } from "./constants.js";
import { ScopeCollisionError } from "./errors.js";
import type { GitRepo } from "./git.js";
import type { ActiveScopeOverlapDetectorPort } from "./ports.js";
import type { HumanFixStateDb } from "./state-db.js";
import type { ScopeReconcilePrompt, ScopeReconcileResult } from "./types.js";

export interface ContractFieldDelta {
  readonly contractId: string;
  readonly field: string;
  readonly kind: "additive" | "modified";
}

export class DeterministicSchemaDiffClassifier {
  classifyContractDeltas(paths: readonly string[], diffText: string): ContractFieldDelta[] {
    const out: ContractFieldDelta[] = [];
    if (paths.some((p) => p.includes("contracts/") || p.endsWith("order.ts"))) {
      const fieldMatch = /cutoffGraceMinutes|(\w+)\s*:\s*\w+/g;
      let match: RegExpExecArray | null;
      while ((match = fieldMatch.exec(diffText)) !== null) {
        const field = match[1] ?? match[0];
        if (field === "cutoffGraceMinutes") {
          out.push({ contractId: "Order", field: "cutoffGraceMinutes", kind: "additive" });
        }
      }
    }
    return out;
  }
}

export interface ScopeReconcileInput {
  readonly taskId: string;
  readonly repo: GitRepo;
  readonly baseSha: string;
  readonly headSha?: string;
  readonly confirmExtraFiles?: boolean;
  readonly confirmContract?: boolean;
}

export class HumanScopeAndContractReconciler {
  private readonly classifier = new DeterministicSchemaDiffClassifier();

  constructor(
    private readonly state: HumanFixStateDb,
    private readonly overlap: ActiveScopeOverlapDetectorPort,
  ) {}

  reconcile(input: ScopeReconcileInput): ScopeReconcileResult {
    const task = this.state.requireTask(input.taskId);
    const head = input.headSha ?? input.repo.revParse("HEAD");
    const changed = input.repo.diffNameOnly(input.baseSha, head);
    const scope = new Set(task.writeScope);
    const extra = changed.filter((p) => !scope.has(p) && !this.matchesScopePrefix(p, task.writeScope));
    const untracked = input.repo.statusPorcelain().filter((f) => f.untracked);
    const prompts: ScopeReconcilePrompt[] = [];
    const included: string[] = [...task.writeScope.filter((p) => changed.includes(p))];
    const held: string[] = [];
    for (const path of extra) {
      prompts.push({
        kind: "extra_file",
        path,
        message: `Your fix also updated ${path} — Include in task and update graph ownership?`,
      });
      if (input.confirmExtraFiles) {
        const sibling = this.overlap.findCollidingActiveTask([path], input.taskId);
        if (sibling) {
          this.state.registerActiveWorker(sibling, 1, [path]);
          held.push(sibling);
        }
        included.push(path);
      }
    }
    for (const file of untracked) {
      prompts.push({
        kind: "untracked_include",
        path: file.path,
        message: `Include new file ${file.path}?`,
      });
      if (input.confirmExtraFiles) included.push(file.path);
    }
    const diff = input.repo.ok(["diff", input.baseSha, head]).stdout;
    const deltas = this.classifier.classifyContractDeltas(changed, diff);
    const contractUpdates: { contractId: string; field: string; basis: "explicit" }[] = [];
    for (const delta of deltas) {
      prompts.push({
        kind: "contract_delta",
        path: changed.find((p) => p.includes("contract") || p.includes("order")) ?? changed[0] ?? "",
        contractField: delta.field,
        message: `Update canonical ${delta.contractId} contract in Knowledge DB so downstream tasks see ${delta.field}?`,
      });
      if (input.confirmContract) {
        this.state.upsertContract(delta.contractId, delta.field, input.taskId, "explicit");
        contractUpdates.push({ contractId: delta.contractId, field: delta.field, basis: "explicit" });
      }
    }
    if (held.length > 0 && extra.length > 0 && !input.confirmExtraFiles) {
      const path = extra[0];
      if (path) {
        const sibling = this.overlap.findCollidingActiveTask([path], input.taskId);
        if (sibling) {
          throw new ScopeCollisionError(path, sibling);
        }
      }
    }
    this.state.tagHumanPaths(input.taskId, included);
    if (contractUpdates.length > 0) {
      this.state.setTaskState(input.taskId, ACCEPTED);
    }
    return {
      includedPaths: included,
      contractUpdates,
      heldSiblingTaskIds: held,
      prompts,
    };
  }

  private matchesScopePrefix(path: string, scope: readonly string[]): boolean {
    return scope.some((entry) => path === entry || path.startsWith(`${entry}/`));
  }
}