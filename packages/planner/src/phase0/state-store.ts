import path from "node:path";
import { bindKnowledgeGraph, type ProjectStateDb } from "@ef-harness/db";

import { Phase0Error } from "./errors.js";
import { openPlannerState } from "../state/project-db.js";
import type { ActionCard, FoundationManifest, Gate0Receipt, Phase0Plan, TaskStatus } from "./types.js";

export interface StoredTask {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly integrationSha: string | null;
  readonly unmergedSha: string | null;
  readonly attempt: number;
  readonly worktreePath: string | null;
  readonly branch: string | null;
}

export interface StoredRun {
  readonly projectId: string;
  readonly plan: Phase0Plan;
  readonly projectKind: Phase0Plan["projectKind"];
  readonly registryOffline: boolean;
  readonly playwrightBrowserAvailable: boolean;
  readonly status: string;
}

interface Checkpoint {
  run: StoredRun | null;
  tasks: StoredTask[];
  installHash: string | null;
  quarantine: string[];
  cards: Array<{ card: ActionCard; createdAt: number }>;
  receipts: Gate0Receipt[];
  manifest: FoundationManifest | null;
  touchedAt: number;
}

/**
 * Phase 0 checkpoint on the shared `ProjectStateDb` writer.
 * The whole run is one `plan` node. There is no private SQLite schema.
 */
export class Phase0StateStore {
  private constructor(private readonly state: ProjectStateDb) {}

  static open(file: string): Phase0StateStore {
    return new Phase0StateStore(openPlannerState(path.dirname(file)));
  }

  close(): void {
    this.state.close();
  }

  saveRun(run: StoredRun): void {
    const checkpoint = this.load(run.projectId);
    checkpoint.run = run;
    this.save(run.projectId, checkpoint);
  }

  readRun(projectId: string): StoredRun | null {
    return this.load(projectId).run;
  }

  queueIfAbsent(projectId: string, taskId: string, now: number): void {
    const checkpoint = this.load(projectId);
    checkpoint.touchedAt = now;
    if (checkpoint.tasks.some((task) => task.taskId === taskId)) return;
    checkpoint.tasks.push({
      taskId,
      status: "queued",
      integrationSha: null,
      unmergedSha: null,
      attempt: 1,
      worktreePath: null,
      branch: null,
    });
    this.save(projectId, checkpoint);
  }

  mark(projectId: string, task: StoredTask, now: number): void {
    const checkpoint = this.load(projectId);
    checkpoint.touchedAt = now;
    const index = checkpoint.tasks.findIndex((item) => item.taskId === task.taskId);
    if (index >= 0) checkpoint.tasks[index] = task;
    else checkpoint.tasks.push(task);
    this.save(projectId, checkpoint);
  }

  getTask(projectId: string, taskId: string): StoredTask | null {
    return this.load(projectId).tasks.find((task) => task.taskId === taskId) ?? null;
  }

  listTasks(projectId: string): StoredTask[] {
    return [...this.load(projectId).tasks].sort((left, right) => left.taskId.localeCompare(right.taskId));
  }

  saveInstallHash(projectId: string, lockfileHash: string): void {
    const checkpoint = this.load(projectId);
    checkpoint.installHash = lockfileHash;
    this.save(projectId, checkpoint);
  }

  installHash(projectId: string): string | null {
    return this.load(projectId).installHash;
  }

  replaceQuarantine(projectId: string, testIds: readonly string[]): void {
    const checkpoint = this.load(projectId);
    checkpoint.quarantine = [...testIds];
    this.save(projectId, checkpoint);
  }

  quarantine(projectId: string): string[] {
    return [...this.load(projectId).quarantine].sort((left, right) => left.localeCompare(right));
  }

  saveActionCard(projectId: string, card: ActionCard, now: number): void {
    const checkpoint = this.load(projectId);
    checkpoint.cards.push({ card, createdAt: now });
    this.save(projectId, checkpoint);
  }

  actionCards(projectId: string): ActionCard[] {
    return [...this.load(projectId).cards]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((item) => item.card);
  }

  saveReceipt(receipt: Gate0Receipt): void {
    const checkpoint = this.load(receipt.projectId);
    checkpoint.receipts.push(receipt);
    this.save(receipt.projectId, checkpoint);
  }

  latestReceipt(projectId: string, integrationSha?: string): Gate0Receipt | null {
    const receipts = this.load(projectId).receipts.filter((receipt) =>
      integrationSha === undefined ? true : receipt.integrationSha === integrationSha,
    );
    const latest = receipts.sort((left, right) => right.recordedAt - left.recordedAt)[0];
    return latest ?? null;
  }

  saveManifest(projectId: string, manifest: FoundationManifest, now: number): void {
    const checkpoint = this.load(projectId);
    checkpoint.touchedAt = now;
    checkpoint.manifest = manifest;
    this.save(projectId, checkpoint);
  }

  manifest(projectId: string): FoundationManifest | null {
    return this.load(projectId).manifest;
  }

  private load(projectId: string): Checkpoint {
    const row = this.state.writer.get("SELECT text FROM nodes WHERE id = ? AND kind = 'plan' AND status = 'active'", [
      nodeId(projectId),
    ]);
    if (!isRecord(row) || typeof row.text !== "string" || row.text.length === 0) return emptyCheckpoint();
    const parsed: unknown = JSON.parse(row.text);
    if (!isRecord(parsed)) return emptyCheckpoint();
    return {
      run: isRecord(parsed.run) ? (parsed.run as unknown as StoredRun) : null,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(readTask) : [],
      installHash: typeof parsed.installHash === "string" ? parsed.installHash : null,
      quarantine: Array.isArray(parsed.quarantine) ? parsed.quarantine.filter((item): item is string => typeof item === "string") : [],
      cards: Array.isArray(parsed.cards) ? parsed.cards.flatMap(readCard) : [],
      receipts: Array.isArray(parsed.receipts) ? (parsed.receipts as Gate0Receipt[]) : [],
      manifest: isRecord(parsed.manifest) ? (parsed.manifest as unknown as FoundationManifest) : null,
      touchedAt: typeof parsed.touchedAt === "number" ? parsed.touchedAt : 0,
    };
  }

  private save(projectId: string, checkpoint: Checkpoint): void {
    const id = nodeId(projectId);
    const text = JSON.stringify(checkpoint);
    const title = `Phase 0 ${projectId}`;
    const fields = { record: "phase0_checkpoint", projectId };
    const repo = bindKnowledgeGraph(this.state);
    const existing = this.state.writer.get("SELECT id FROM nodes WHERE id = ?", [id]);
    if (existing) {
      repo.commitChangeSet({
        origin: "planner",
        author: "phase0",
        summary: `phase0 ${projectId}`,
        nodes: [{ op: "update", id, class: "compatible", title, text, fields }],
      });
      return;
    }
    repo.commitChangeSet({
      origin: "planner",
      author: "phase0",
      summary: `phase0 ${projectId}`,
      nodes: [{ op: "create", id, kind: "plan", title, text, fields }],
    });
  }
}

function nodeId(projectId: string): string {
  return `phase0:${projectId}`;
}

function emptyCheckpoint(): Checkpoint {
  return { run: null, tasks: [], installHash: null, quarantine: [], cards: [], receipts: [], manifest: null, touchedAt: 0 };
}

function readTask(value: unknown): StoredTask {
  if (!isRecord(value) || typeof value.taskId !== "string" || typeof value.status !== "string" || !isStatus(value.status)) {
    throw new Phase0Error("task_status", "Phase 0 checkpoint task is unreadable");
  }
  return {
    taskId: value.taskId,
    status: value.status,
    integrationSha: typeof value.integrationSha === "string" ? value.integrationSha : null,
    unmergedSha: typeof value.unmergedSha === "string" ? value.unmergedSha : null,
    attempt: typeof value.attempt === "number" ? value.attempt : 1,
    worktreePath: typeof value.worktreePath === "string" ? value.worktreePath : null,
    branch: typeof value.branch === "string" ? value.branch : null,
  };
}

function readCard(value: unknown): Array<{ card: ActionCard; createdAt: number }> {
  if (!isRecord(value) || !isRecord(value.card)) return [];
  const card = value.card;
  if (typeof card.id !== "string" || typeof card.taskId !== "string" || typeof card.message !== "string") return [];
  return [
    {
      card: { id: card.id, kind: "kernel_installer_error", taskId: card.taskId, message: card.message, blocksStage0B: true },
      createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    },
  ];
}

function isStatus(value: string): value is TaskStatus {
  return value === "queued" || value === "running" || value === "done" || value === "failed" || value === "blocked";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
