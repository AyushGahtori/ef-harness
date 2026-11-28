import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectRemovedSymbols, runStaticAudit } from "./audit.js";
import {
  ARCHIVE_CHECKPOINT_PREFIX,
  ARCHIVE_FEATURE_PREFIX,
  CHECKPOINT_PREFIX,
  DATA_DROP,
  DATA_KEEP_DORMANT,
  FEATURE_REF_PREFIX,
  HARNESS_VERSION,
  INTEGRATION_BRANCH,
  LLM_TOKENS,
} from "./constants.js";
import { UndoDataRetentionDialog } from "./dialog.js";
import { DestructiveDropError, HistoryRewriteError, UndoError, UndoNotConfirmedError } from "./errors.js";
import { CombinedRegressionGatePort } from "./gate.js";
import {
  addedLines,
  assertForwardCommit,
  forEachRef,
  listTree,
  parseEfTrailers,
  readBlob,
  renderTrailers,
  type GitRepo,
} from "./git.js";
import { FeatureUndoInventoryAnalyzer } from "./inventory.js";
import { SharedOwnershipTransferPlanner } from "./ownership.js";
import { ActiveTaskHaltPort, InboxRetirementPort } from "./ports.js";
import { RefLeasePort } from "./ref-lease.js";
import { isMigrationPath, removeAddedLines } from "./scan.js";
import type { KnowledgeGraphPort } from "./state-db.js";
import type {
  DataHandlingChoice,
  RegressionReport,
  StaticAuditReport,
  UndoChoice,
  UndoInventory,
  UndoPreview,
  UndoResult,
  OwnershipTransfer,
} from "./types.js";

export interface ExecutorDeps {
  readonly git: GitRepo;
  readonly graph: KnowledgeGraphPort;
  readonly analyzer: FeatureUndoInventoryAnalyzer;
  readonly planner: SharedOwnershipTransferPlanner;
  readonly dialog: UndoDataRetentionDialog;
  readonly gate: CombinedRegressionGatePort;
  readonly lease: RefLeasePort;
  readonly halt: ActiveTaskHaltPort;
  readonly inbox: InboxRetirementPort;
  readonly now: () => number;
  readonly beforeCas?: (info: { readonly newSha: string; readonly oldSha: string }) => void;
}

const EMPTY_AUDIT: StaticAuditReport = { ok: true, deadNav: [], danglingImports: [], orphanPermissions: [] };

/**
 * Step 3. Fast-path `git revert -m 1` when the merge is exclusively owned and
 * merge-tree is clean. Otherwise a surgical removal that keeps shared pieces.
 * The integration ref moves only by compare-and-swap of a forward commit.
 */
export class FeatureUndoExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  async execute(featureId: string, choice: UndoChoice): Promise<UndoResult> {
    const started = performance.now();
    const previousSha = this.deps.git.integrationSha();
    const inventory = this.deps.analyzer.analyze(featureId);
    const transfers = this.deps.planner.plan(inventory);
    const preview = this.deps.dialog.present(inventory, transfers);
    if (!choice.apply) throw new UndoNotConfirmedError();
    if (inventory.hardDependents.length > 0 && !choice.dependents) {
      return this.blocked(preview, previousSha, started, "Choose undo together or cancel undo", inventory.hardDependents);
    }
    if (choice.dependents === "cancel") {
      return this.blocked(preview, previousSha, started, "Cancel undo", [featureId, ...inventory.hardDependents], "cancelled");
    }
    const featureIds =
      choice.dependents === "undo_together" ? [featureId, ...inventory.hardDependents] : [featureId];
    const inventories = featureIds.map((id) => (id === featureId ? inventory : this.deps.analyzer.analyze(id)));
    const flying = inventories.filter((item) => item.inFlight);
    const landed = inventories.filter((item) => !item.inFlight);
    const halted: string[] = [];
    const retired: string[] = [];
    for (const item of flying) {
      const cancelled = this.cancelInFlight(item.featureId);
      halted.push(...cancelled.halted);
      retired.push(...cancelled.retired);
    }
    if (landed.length === 0) {
      return this.finish({
        landed: false,
        mode: "in_flight_cancel",
        commitSha: "",
        previousSha,
        preview,
        transfers: [],
        audit: EMPTY_AUDIT,
        regression: null,
        blockedReason: "",
        started,
        featureIds,
        nodeStatus: "undone",
        halted,
        retired,
      });
    }
    const dataHandling = choice.dataHandling ?? DATA_KEEP_DORMANT;
    this.assertDropAllowed(landed, dataHandling, choice.destructiveConfirmation === true);
    const allTransfers = landed.flatMap((item) => this.deps.planner.plan(item));
    return this.land(landed, allTransfers, preview, previousSha, started, dataHandling, halted, retired);
  }

  private cancelInFlight(featureId: string): { halted: string[]; retired: string[] } {
    const before = this.deps.git.integrationSha();
    const halted = this.deps.halt.haltFeature(featureId);
    const retired = this.deps.inbox.retireExclusive(featureId);
    const branchSha = this.deps.git.run(["rev-parse", "--verify", `${FEATURE_REF_PREFIX}${featureId}`]);
    if (branchSha.status === 0) {
      const sha = branchSha.stdout.trim();
      this.deps.git.ok(["update-ref", `${ARCHIVE_FEATURE_PREFIX}${featureId}`, sha]);
      this.deps.git.ok(["update-ref", "-d", `${FEATURE_REF_PREFIX}${featureId}`]);
    }
    for (const checkpoint of forEachRef(this.deps.git, `${CHECKPOINT_PREFIX}${featureId}`)) {
      const name = checkpoint.ref.slice(`${CHECKPOINT_PREFIX}${featureId}/`.length);
      this.deps.git.ok(["update-ref", `${ARCHIVE_CHECKPOINT_PREFIX}${featureId}/${name}`, checkpoint.sha]);
      this.deps.git.ok(["update-ref", "-d", checkpoint.ref]);
    }
    this.deps.graph.markUndone(featureId);
    const after = this.deps.git.integrationSha();
    if (before !== after) {
      throw new HistoryRewriteError("in-flight cancel moved harness/integration");
    }
    return { halted, retired };
  }

  private async land(
    inventories: readonly UndoInventory[],
    transfers: readonly OwnershipTransfer[],
    preview: UndoPreview,
    previousSha: string,
    started: number,
    dataHandling: DataHandlingChoice,
    halted: readonly string[],
    retiredAlready: readonly string[],
  ): Promise<UndoResult> {
    const featureIds = inventories.map((item) => item.featureId);
    const fastPath = inventories.every((item) => item.fastPathCandidate);
    const lease = this.deps.lease.acquire(previousSha);
    const slot = path.join(tmpdir(), `ef-undo-${process.pid}-${randomBytes(4).toString("hex")}`);
    let committed = "";
    try {
      this.deps.git.ok(["worktree", "add", "--detach", slot, INTEGRATION_BRANCH]);
      const slotGit = this.deps.git.child(slot);
      if (fastPath) this.revertAll(slotGit, inventories);
      else this.surgicalAll(slot, inventories, dataHandling);
      this.assertMigrationsUntouched(slot, previousSha);
      const symbols = this.removedSymbols(inventories, previousSha);
      const audit = runStaticAudit(slot, symbols.routes, symbols.permissions);
      const regression = await this.deps.gate.run(slot, featureIds, audit);
      if (!audit.ok || !regression.ok) {
        return this.finish({
          landed: false,
          mode: fastPath ? "fast_path_revert" : "surgical_removal",
          commitSha: "",
          previousSha,
          preview,
          transfers,
          audit,
          regression,
          blockedReason: audit.ok ? "Combined regression failed" : "STATIC_AUDIT blocked the undo commit",
          started,
          featureIds,
          nodeStatus: "active",
          halted,
          retired: retiredAlready,
        });
      }
      const message = this.message(inventories, fastPath);
      slotGit.ok(["add", "-A"]);
      slotGit.ok(["commit", "-m", message]);
      committed = slotGit.revParse("HEAD");
      assertForwardCommit(this.deps.git, committed, previousSha);
      this.deps.beforeCas?.({ newSha: committed, oldSha: previousSha });
      const cas = this.deps.lease.advance(committed, previousSha, lease.epoch);
      if (!cas.ok) {
        return this.finish({
          landed: false,
          mode: fastPath ? "fast_path_revert" : "surgical_removal",
          commitSha: "",
          previousSha,
          preview,
          transfers,
          audit,
          regression,
          blockedReason: "cas_mismatch",
          started,
          featureIds,
          nodeStatus: "active",
          halted,
          retired: retiredAlready,
        });
      }
      const retired = [...retiredAlready];
      this.deps.graph.transaction(() => {
        for (const transfer of transfers) {
          this.deps.graph.transferOwnership(transfer.path, transfer.toFeatureId, transfer.fromFeatureId, this.deps.now());
        }
        for (const id of featureIds) {
          retired.push(...this.deps.inbox.retireExclusive(id));
          this.deps.graph.markUndone(id);
        }
      });
      return this.finish({
        landed: true,
        mode: fastPath ? "fast_path_revert" : "surgical_removal",
        commitSha: committed,
        previousSha,
        preview,
        transfers,
        audit,
        regression,
        blockedReason: "",
        started,
        featureIds,
        nodeStatus: "undone",
        halted,
        retired,
      });
    } finally {
      this.deps.git.run(["worktree", "remove", "--force", slot]);
      this.deps.lease.release(lease.epoch);
    }
  }

  private revertAll(slotGit: GitRepo, inventories: readonly UndoInventory[]): void {
    const newestFirst = [...inventories].sort((left, right) => {
      if (this.deps.git.isAncestor(left.mergeSha, right.mergeSha)) return 1;
      if (this.deps.git.isAncestor(right.mergeSha, left.mergeSha)) return -1;
      return 0;
    });
    for (const inventory of newestFirst) {
      slotGit.ok(["revert", "-m", "1", "--no-commit", inventory.mergeSha]);
    }
  }

  private surgicalAll(slot: string, inventories: readonly UndoInventory[], dataHandling: DataHandlingChoice): void {
    for (const inventory of inventories) this.applySurgical(slot, inventory, dataHandling);
  }

  private applySurgical(slot: string, inventory: UndoInventory, dataHandling: DataHandlingChoice): void {
    for (const item of inventory.exclusive) {
      if (item.path.startsWith("db:") || isMigrationPath(item.path)) continue;
      if (item.status === "A") {
        removeRepoFile(slot, item.path);
        continue;
      }
      const before = readBlob(this.deps.git, `${inventory.mergeSha}^1`, item.path);
      if (before === null) removeRepoFile(slot, item.path);
      else writeRepoFile(slot, item.path, before);
    }
    for (const item of inventory.shared) {
      if (item.path.startsWith("db:") || isMigrationPath(item.path)) continue;
      if (item.status !== "M" || !item.reasons.includes("later_edit")) continue;
      const head = readBlob(this.deps.git, INTEGRATION_BRANCH, item.path);
      if (head === null) continue;
      const added = addedLines(this.deps.git, inventory.mergeSha, item.path);
      writeRepoFile(slot, item.path, removeAddedLines(head, added));
    }
    if (dataHandling !== DATA_DROP) return;
    const tables = inventory.persistentData.filter((item) => item.kind === "table").map((item) => item.symbol);
    if (tables.length === 0) return;
    const stamp = new Date(this.deps.now()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const body = [
      `-- additive-safe down migration for undone feature ${inventory.featureId}`,
      "-- historical migration files are unchanged",
      ...tables.map((table) => `DROP TABLE IF EXISTS ${table};`),
      "",
    ].join("\n");
    writeRepoFile(slot, `migrations/${stamp}_drop_${tables.join("_")}.sql`, body);
  }

  private assertDropAllowed(inventories: readonly UndoInventory[], dataHandling: DataHandlingChoice, confirmed: boolean): void {
    const persistent = inventories.flatMap((item) => item.persistentData);
    if (dataHandling !== DATA_DROP) return;
    if (!confirmed) {
      throw new DestructiveDropError(
        "Dropping a table or column requires explicit destructive confirmation. The safe default is keep schema/data dormant.",
      );
    }
    const shared = persistent.filter((item) => item.referencedBy.length > 0);
    if (shared.length > 0) {
      throw new DestructiveDropError(
        `Refusing to drop ${shared.map((item) => item.path).join(", ")} because another feature still references it.`,
      );
    }
  }

  private assertMigrationsUntouched(slot: string, baseSha: string): void {
    for (const file of listTree(this.deps.git, baseSha).filter(isMigrationPath)) {
      const original = readBlob(this.deps.git, baseSha, file);
      if (original === null) continue;
      const full = path.join(slot, ...file.split("/"));
      let current = "";
      try {
        current = readFileSync(full, "utf8");
      } catch {
        throw new UndoError("migration_rewrite", `Historical migration ${file} was removed. Expand-then-contract leaves it in place.`);
      }
      if (current !== original) {
        throw new UndoError("migration_rewrite", `Historical migration ${file} was edited. Add a new migration instead.`);
      }
    }
  }

  private removedSymbols(inventories: readonly UndoInventory[], baseSha: string): { routes: string[]; permissions: string[] } {
    const blobs: string[] = [];
    const routes = new Set<string>();
    for (const inventory of inventories) {
      for (const item of inventory.exclusive) {
        if (item.symbol.startsWith("/")) {
          for (const route of item.symbol.split(",")) if (route.startsWith("/")) routes.add(route);
        }
        if (item.path.startsWith("db:")) continue;
        const blob = readBlob(this.deps.git, baseSha, item.path);
        if (blob !== null) blobs.push(blob);
      }
    }
    const collected = collectRemovedSymbols(blobs);
    return { routes: [...new Set([...routes, ...collected.routes])], permissions: collected.permissions };
  }

  private message(inventories: readonly UndoInventory[], fastPath: boolean): string {
    const featureIds = inventories.map((item) => item.featureId);
    const primary = inventories[0];
    const trailers = primary ? parseEfTrailers(this.deps.git.commitMessage(primary.mergeSha)) : null;
    const tasks = [...new Set(inventories.flatMap((item) => this.deps.graph.getFeature(item.featureId)?.taskIds ?? trailers?.tasks ?? []))];
    const requirements = trailers?.requirements ?? [];
    const subject = `undo ${featureIds.join(" + ")}`;
    const body = fastPath
      ? "Fast-path clean merge revert. Shared pieces were absent and merge-tree was clean."
      : "Planned surgical removal. Shared ownership stays, and database schema stays dormant unless a new migration was requested.";
    return renderTrailers(
      subject,
      body,
      {
        feature: featureIds.join(","),
        tasks,
        requirements,
        checksPassed: createHash("sha256").update(`undo:${featureIds.join(",")}`).digest("hex"),
        harnessVersion: HARNESS_VERSION,
      },
      [
        ["EF-Undo", "forward"],
        ["EF-Undo-Of", inventories.map((item) => item.mergeSha).join(",")],
        ["EF-Llm-Tokens", "0"],
      ],
    );
  }

  private blocked(
    preview: UndoPreview,
    previousSha: string,
    started: number,
    reason: string,
    featureIds: readonly string[],
    mode: "blocked" | "cancelled" = "blocked",
  ): UndoResult {
    return this.finish({
      landed: false,
      mode,
      commitSha: "",
      previousSha,
      preview,
      transfers: preview.transfers,
      audit: EMPTY_AUDIT,
      regression: null,
      blockedReason: reason,
      started,
      featureIds,
      nodeStatus: "active",
      halted: [],
      retired: [],
    });
  }

  private finish(input: {
    readonly landed: boolean;
    readonly mode: UndoResult["mode"];
    readonly commitSha: string;
    readonly previousSha: string;
    readonly preview: UndoPreview;
    readonly transfers: readonly OwnershipTransfer[];
    readonly audit: StaticAuditReport;
    readonly regression: RegressionReport | null;
    readonly blockedReason: string;
    readonly started: number;
    readonly featureIds: readonly string[];
    readonly nodeStatus: string;
    readonly halted: readonly string[];
    readonly retired: readonly string[];
  }): UndoResult {
    if (this.deps.git.commands.some((command) => /(^|\s)(reset|rebase|filter-branch)(\s|$)/.test(command))) {
      throw new HistoryRewriteError(this.deps.git.commands.join(" | "));
    }
    const integrationSha = this.deps.git.integrationSha();
    const nodeStatus = input.featureIds.every((id) => this.deps.graph.getFeature(id)?.nodeStatus === "undone")
      ? "undone"
      : input.nodeStatus;
    return {
      landed: input.landed,
      mode: input.mode,
      commitSha: input.commitSha,
      previousSha: input.previousSha,
      integrationSha,
      integrationUnchanged: integrationSha === input.previousSha,
      llmTokens: LLM_TOKENS,
      featureIds: input.featureIds,
      nodeStatus,
      audit: input.audit,
      regression: input.regression,
      transfers: input.transfers,
      preview: input.preview,
      blockedReason: input.blockedReason,
      elapsedMs: performance.now() - input.started,
      historyRewritten: false,
      commands: [...this.deps.git.commands],
      haltedWorkerIds: input.halted,
      retiredQuestionIds: input.retired,
    };
  }
}

function writeRepoFile(root: string, relative: string, text: string): void {
  const full = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text.replaceAll("\r\n", "\n"), "utf8");
}

function removeRepoFile(root: string, relative: string): void {
  rmSync(path.join(root, ...relative.split("/")), { force: true });
}
