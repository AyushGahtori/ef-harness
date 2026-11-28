import type { DatabaseSync } from "node:sqlite";
import { commandIsReadOnly } from "@ef-harness/git-engine";
import { loadManifest } from "@ef-harness/planner";
import type { TaskHoldsManagerPort } from "./dispatcher/ports.js";
import type { TaskHold } from "./dispatcher/types.js";
import { HoldStore } from "./holds/database.js";
import { kernelReasonFor } from "./holds/format.js";
import { ColdOpenReconciler } from "./reentry/cold-open-reconciler.js";
import {
  createEchoCliPort,
  createJournal,
  createNodeCommandRunner,
  createNodeGitInspector,
  createReconcilePorts,
} from "./reentry/ports.js";
import type {
  CommandRunner,
  IoJournal,
  MinGitRepoInspectorPort,
  SharedQuestionArbiterPort,
  ViewManifestHashScannerPort,
} from "./reentry/ports.js";
import type { OpenQuestionRecord, StateDbSnapshot } from "./reentry/types.js";
import { ensureTaskRuntime } from "./state-seed.js";

/**
 * Route 114 hold placement lands on the Task 115 store and canonical task_holds.
 * Cold open still waits for an explicit Resume click.
 */
export function durableTaskHolds(db: DatabaseSync): TaskHoldsManagerPort {
  const store = new HoldStore(db);
  return {
    placeHold(taskId: string, reason: string, source: string, createdAtMs: number): TaskHold {
      ensureTaskRuntime(db, taskId, taskId, "CODING", taskId);
      store.stageHold({
        taskId,
        featureId: taskId,
        reasonType: reason,
        reasonRefId: source,
        mode: "HARD_HOLD",
        quarantine: false,
        explanation: reason,
        messageId: source,
        createdAt: createdAtMs,
      });
      return { taskId, reason: kernelReasonFor(reason), source, createdAtMs };
    },
    releaseHold(taskId: string, reason: string): number {
      const kernel = kernelReasonFor(reason);
      const rows = db.prepare(`SELECT source FROM task_holds WHERE task = ? AND reason = ?`).all(taskId, kernel) as {
        source?: string;
      }[];
      for (const row of rows) {
        if (typeof row.source !== "string") continue;
        db.prepare(`DELETE FROM task_holds WHERE task = ? AND reason = ? AND source = ?`).run(taskId, kernel, row.source);
        db.prepare(`DELETE FROM hold_reason_details WHERE task = ? AND reason = ? AND source = ?`).run(taskId, kernel, row.source);
      }
      return rows.length;
    },
    listActiveHolds(taskId?: string): readonly TaskHold[] {
      const rows = (
        taskId === undefined
          ? db.prepare(`SELECT task, reason, source, created_at FROM task_holds ORDER BY task, source`).all()
          : db.prepare(`SELECT task, reason, source, created_at FROM task_holds WHERE task = ? ORDER BY source`).all(taskId)
      ) as { task?: string; reason?: string; source?: string; created_at?: number }[];
      return rows.map((row) => ({
        taskId: String(row.task),
        reason: String(row.reason),
        source: String(row.source),
        createdAtMs: Number(row.created_at),
      }));
    },
  };
}

/** Cold open reads git through git-engine's read-only classifier. */
export function createGitEngineInspector(journal: IoJournal = createJournal()): MinGitRepoInspectorPort {
  const inner = createNodeCommandRunner(journal);
  const runner: CommandRunner = {
    run(command: string, args: readonly string[], cwd: string) {
      if (command === "git" && !commandIsReadOnly(args)) {
        throw new Error(`Refusing git command during cold open: git ${args.join(" ")}`);
      }
      return inner.run(command, args, cwd);
    },
  };
  return createNodeGitInspector(runner);
}

/** Task 085 view manifest, read on cold open and never written. */
export function createPlannerViewScanner(): ViewManifestHashScannerPort {
  return {
    scan(projectRoot: string) {
      const manifest = loadManifest(`${projectRoot}/.harness/views`);
      return manifest.files.map((file) => ({ path: file.filePath, sha256: file.contentSha256 }));
    },
  };
}

/** Open questions are canonical inbox_items. Retired cards are dismissed, not a fifth status. */
export function inboxQuestionPort(db: DatabaseSync): SharedQuestionArbiterPort {
  return {
    listOpen(): readonly OpenQuestionRecord[] {
      const rows = db
        .prepare(`SELECT id, subject, payload, created_at FROM inbox_items WHERE status = 'open' ORDER BY created_at, id`)
        .all() as { id?: string; subject?: string; payload?: string; created_at?: number }[];
      const records: OpenQuestionRecord[] = [];
      for (const row of rows) {
        if (typeof row.id !== "string") continue;
        let neededByTaskId: string | null = null;
        if (typeof row.payload === "string") {
          try {
            const parsed = JSON.parse(row.payload) as { subscribers?: { waitingTaskId?: string; active?: boolean }[] };
            const active = parsed.subscribers?.find((subscriber) => subscriber.active && typeof subscriber.waitingTaskId === "string");
            neededByTaskId = active?.waitingTaskId ?? null;
          } catch {
            neededByTaskId = null;
          }
        }
        records.push({
          id: row.id,
          prompt: typeof row.subject === "string" ? row.subject : row.id,
          openedAt: new Date(Number(row.created_at ?? 0)).toISOString(),
          targetFiles: [],
          decisionContext: null,
          neededByTaskId,
          effectHint: null,
          revalidation: "still_relevant",
          sinceLabel: null,
        });
      }
      return records;
    },
  };
}

/**
 * Cold open stays behind NoRunUntilResumeGate. This factory does not click Resume.
 */
export function openColdOpenReconciler(db: DatabaseSync, journal: IoJournal = createJournal()): ColdOpenReconciler {
  const empty = { cliVersions: [], questions: [] } as Pick<StateDbSnapshot, "cliVersions" | "questions"> as StateDbSnapshot;
  return new ColdOpenReconciler(
    createReconcilePorts(empty, {
      journal,
      git: createGitEngineInspector(journal),
      questions: inboxQuestionPort(db),
      views: createPlannerViewScanner(),
      clis: createEchoCliPort([]),
    }),
  );
}
