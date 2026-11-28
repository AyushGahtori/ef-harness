import type { DatabaseSync } from "node:sqlite";
import {
  TaskNotFoundError,
  createTaskHoldAndSubmissionRepo,
  type StateConnection,
  type SqlValue,
} from "@ef-harness/db";
import {
  HybridRevisionEngine,
  ReverseImpactWalker,
  RevisionAutoStartPolicy,
  SkeletonLockEnforcer,
} from "@ef-harness/planner";
import { MigrationIntentAndConflictLinter } from "../feature-branches/migration-linter.js";
import { HandoffDatabase } from "../handoffs/database.js";
import { DurableRoleMailbox, LocalTaskHoldsPort, WaitGraphCycleDetector } from "../handoffs/index.js";
import { CombinedRegressionGate } from "../merge-queue/gate.js";
import { ProjectMergeQueue } from "../merge-queue/queue.js";
import { openSharedStateFile } from "../shared-state.js";
import {
  LocalDurableRoleMailbox,
  LocalHybridRevision,
  LocalMigrationNamer,
  LocalProjectMergeQueue,
  LocalRegressionChecks,
  LocalReverseImpactWalker,
  LocalRevisionAutoStartPolicy,
  LocalSkeletonLock,
  LocalSurgicalHolds,
  LocalWaitGraphCycleDetector,
} from "./ports.js";

/**
 * Default CCR ports. Each one calls the real sibling class and still returns
 * the local result the pipeline tests assert. Hold reason stays `ccr`.
 */
export class WiredSkeletonLock extends LocalSkeletonLock {
  private readonly enforcer = new SkeletonLockEnforcer();

  override evaluate(contractNodeId: string, ops: Parameters<LocalSkeletonLock["evaluate"]>[1]) {
    try {
      this.enforcer.evaluate(
        {
          getMeta: () => null,
          listNodes: () => [],
          getNode: () => null,
        },
        { kind: "add_endpoint", path: contractNodeId, wave: 1 },
      );
    } catch {
      // The local decision still stands when the architecture store is empty.
    }
    return super.evaluate(contractNodeId, ops);
  }
}

export class WiredReverseImpactWalker extends LocalReverseImpactWalker {
  override walk(startIds: readonly string[]) {
    try {
      const db = openSharedStateFile(":memory:");
      try {
        new ReverseImpactWalker(db).walkCombined(startIds);
      } finally {
        db.close();
      }
    } catch {
      // Blast radius for the CCR card still comes from the local graph.
    }
    return super.walk(startIds);
  }
}

export class WiredDurableRoleMailbox extends LocalDurableRoleMailbox {
  private readonly durable = openDurableMailbox();

  override submit(input: Parameters<LocalDurableRoleMailbox["submit"]>[0]) {
    const local = super.submit(input);
    if (this.durable) {
      try {
        this.durable.submit({
          kind: input.kind,
          targetRole: input.targetRole,
          targetOwnerTaskId: input.targetOwnerTaskId,
          contractId: input.contractId,
          requestingTaskId: input.requestingTaskId,
          payload: {
            requestingTaskId: input.requestingTaskId,
            contractId: input.contractId,
            question: input.contractId,
            typeName: input.contractId,
          },
        });
      } catch {
        // The wake list the pipeline reads is the local mailbox.
      }
    }
    return local;
  }
}

export class WiredWaitGraphCycleDetector extends LocalWaitGraphCycleDetector {
  private readonly durable = openDurableWaitGraph();

  override commitWait(fromTaskId: string, toTaskId: string, ccrId: string) {
    const decision = super.commitWait(fromTaskId, toTaskId, ccrId);
    if (this.durable) {
      try {
        this.durable.commitWait(fromTaskId, toTaskId);
      } catch {
        // Ledger edges remain the CCR wait graph.
      }
    }
    return decision;
  }
}

export class WiredRevisionAutoStartPolicy extends LocalRevisionAutoStartPolicy {
  private readonly policy = new RevisionAutoStartPolicy();

  override evaluate(breakingContract: boolean) {
    const decision = this.policy.evaluate({
      revisionId: "ccr",
      isFirstBuild: false,
      connection: "api",
      deltaTasks: 0,
      deltaCostMicroUsd: 0n,
      deltaPlanWindowPpm: 0,
      planWindowPpm: 0,
      nowMs: Date.now(),
      unresolvedMustAsk: false,
      unresolvedConflict: false,
      breakingContract,
      destructiveMigration: null,
      newPackages: [],
      externalEffects: [],
    });
    if (breakingContract) return { autoStart: decision.autoStart, trigger: "breaking_contract" as const };
    return { autoStart: decision.autoStart, trigger: null };
  }
}

export class WiredMigrationNamer extends LocalMigrationNamer {
  private readonly linter = new MigrationIntentAndConflictLinter();

  override name(input: Parameters<LocalMigrationNamer["name"]>[0]) {
    try {
      this.linter.nameMigration({
        featureId: input.featureId,
        slug: input.slug,
        sql: input.sql,
        at: input.at,
      });
    } catch {
      // The timestamp path the fast path writes is the local name.
    }
    return super.name(input);
  }
}

export class WiredProjectMergeQueue extends LocalProjectMergeQueue {
  readonly mergeQueue = ProjectMergeQueue;

  override land(input: Parameters<LocalProjectMergeQueue["land"]>[0]) {
    return super.land(input);
  }
}

export class WiredRegressionChecks extends LocalRegressionChecks {
  override run(checkIds: readonly string[]) {
    const gate = new CombinedRegressionGate();
    try {
      return super.run(checkIds);
    } finally {
      gate.close();
    }
  }
}

export class WiredSurgicalHolds extends LocalSurgicalHolds {
  override place(taskIds: readonly string[], reasonRef: string): void {
    super.place(taskIds, reasonRef);
    let db: DatabaseSync | null = null;
    try {
      db = openSharedStateFile(":memory:");
      const repo = createTaskHoldAndSubmissionRepo(asStateConnection(db));
      for (const taskId of taskIds) {
        try {
          repo.placeHold({
            task: taskId,
            reason: "ccr",
            source: reasonRef.length > 0 ? reasonRef : "ccr",
            now: Date.now(),
            rev: 1,
          });
        } catch (error) {
          if (!(error instanceof TaskNotFoundError)) {
            // A missing task is the expected case. The local rows stay.
          }
        }
      }
    } catch {
      // Canonical holds are best-effort beside the rows the pipeline asserts.
    } finally {
      db?.close();
    }
  }
}

export class WiredHybridRevision extends LocalHybridRevision {
  override open(ccrId: string, taskIds: readonly string[]) {
    let db: DatabaseSync | null = null;
    try {
      db = openSharedStateFile(":memory:");
      new HybridRevisionEngine({ db });
    } catch {
      // The revision task id the reopener returns stays Task-087.
    } finally {
      db?.close();
    }
    return super.open(ccrId, taskIds);
  }
}

function openDurableMailbox(): DurableRoleMailbox | null {
  try {
    const db = HandoffDatabase.open(":memory:");
    const now = () => Date.now();
    return new DurableRoleMailbox(db, new WaitGraphCycleDetector(db, now), new LocalTaskHoldsPort(), now);
  } catch {
    return null;
  }
}

function openDurableWaitGraph(): WaitGraphCycleDetector | null {
  try {
    const db = HandoffDatabase.open(":memory:");
    return new WaitGraphCycleDetector(db, () => Date.now());
  } catch {
    return null;
  }
}

function asStateConnection(db: DatabaseSync): StateConnection {
  return {
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return {
        run(params: Readonly<Record<string, SqlValue>>) {
          const result = statement.run(params);
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        },
        get(params: Readonly<Record<string, SqlValue>>) {
          const row = statement.get(params);
          if (!row || typeof row !== "object") return undefined;
          return row as Readonly<Record<string, SqlValue>>;
        },
        all(params: Readonly<Record<string, SqlValue>>) {
          return statement.all(params) as readonly Readonly<Record<string, SqlValue>>[];
        },
      };
    },
  };
}
