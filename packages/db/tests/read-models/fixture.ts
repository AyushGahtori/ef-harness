import {
  createReadModelRepo,
  openReadModelDatabase,
  type ReadModelConnection,
  type ReadModelLogger,
  type ReadModelRepo,
} from "../../src/read-models/index.js";

export interface OpenedGraph {
  readonly repo: ReadModelRepo;
  readonly db: ReadModelConnection;
  readonly graph: ProjectGraph;
}

export function openGraph(options: {
  readonly location?: string;
  readonly logger?: ReadModelLogger;
} = {}): OpenedGraph {
  const db = openReadModelDatabase({ location: options.location });
  const repo = createReadModelRepo(db, { logger: options.logger });
  return { repo, db, graph: new ProjectGraph(db) };
}

export class ProjectGraph {
  private rev = 0;
  private changeSets = 0;
  private attemptNumbers = new Map<string, number>();

  constructor(private readonly db: ReadModelConnection) {}

  revision(): number {
    return this.rev;
  }

  changeSet(): { id: string; rev: number } {
    this.changeSets += 1;
    this.rev += 1;
    const id = `CS-${String(this.changeSets)}`;
    this.db
      .prepare(
        `INSERT INTO change_sets(id, rev, origin, author, created_at)
         VALUES (?, ?, 'kernel', 'read-model-test', 0)`,
      )
      .run([id, this.rev]);
    return { id, rev: this.rev };
  }

  addNode(
    id: string,
    kind: string,
    title: string,
    fields: Record<string, unknown> = {},
  ): number {
    const change = this.changeSet();
    this.db
      .prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES (?, ?, 1, ?, ?, '', ?, ?, ?, ?)`,
      )
      .run([
        id,
        kind,
        `h-${id}-1`,
        title,
        JSON.stringify(fields),
        change.id,
        change.rev,
        change.rev,
      ]);
    return change.rev;
  }

  addFeature(id: string, state = "PLANNED"): void {
    this.addNode(id, "feature", id, {});
    this.db
      .prepare(
        "INSERT INTO feature_runtime(feature, state, updated_rev) VALUES (?, ?, ?)",
      )
      .run([id, state, this.rev]);
  }

  addTask(id: string, feature: string, state = "READY"): void {
    this.addNode(id, "task", id, { feature });
    this.db
      .prepare(
        `INSERT INTO task_runtime(task, feature, state, level, updated_rev)
         VALUES (?, ?, ?, 'Mid', ?)`,
      )
      .run([id, feature, state, this.rev]);
  }

  addRequirement(
    id: string,
    kind: "rule" | "spec_item" | "edge_case" | "journey",
    fields: Record<string, unknown> = {},
  ): void {
    this.addNode(id, kind, id, fields);
  }

  addCheck(id: string, feature?: string): void {
    this.addNode(id, "check", id, feature === undefined ? {} : { feature });
  }

  addWaiver(
    id: string,
    requirementId: string,
    fields: { reason?: string; approved_by?: string; risk_max?: string },
  ): void {
    this.addNode(id, "waiver", id, fields);
    this.edge(id, "waives", requirementId);
  }

  edge(src: string, type: string, dst: string): void {
    const change = this.changeSet();
    this.db
      .prepare(
        `INSERT INTO edges(src, type, dst, change_set, valid_from_rev)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run([src, type, dst, change.id, change.rev]);
  }

  addAttempt(id: string, task: string): void {
    const n = (this.attemptNumbers.get(task) ?? 0) + 1;
    this.attemptNumbers.set(task, n);
    this.db
      .prepare(
        `INSERT INTO attempts(
           id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at
         ) VALUES (?, ?, ?, 1, 1, 'own', 'm', 'c', 'abc', 'running', 1)`,
      )
      .run([id, task, n]);
  }

  addCheckResult(
    checkId: string,
    attempt: string,
    status: "pass" | "fail" | "skip" | "missing" | "error",
    recordedAt: number,
    checkVersion = 1,
  ): void {
    this.db
      .prepare(
        `INSERT INTO check_results(
           check_id, attempt, check_version, artifact_digest, status, receipt, recorded_at
         ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run([checkId, attempt, checkVersion, `d-${checkId}-${String(recordedAt)}`, status, recordedAt]);
  }

  reviseNode(id: string, fields?: Record<string, unknown>): void {
    const change = this.changeSet();
    if (fields === undefined) {
      this.db
        .prepare(
          `UPDATE nodes
              SET version = version + 1, content_hash = ?, change_set = ?, updated_rev = ?
            WHERE id = ?`,
        )
        .run([`h-${id}-${String(change.rev)}`, change.id, change.rev, id]);
      return;
    }
    this.db
      .prepare(
        `UPDATE nodes
            SET version = version + 1,
                content_hash = ?,
                fields = ?,
                change_set = ?,
                updated_rev = ?
          WHERE id = ?`,
      )
      .run([
        `h-${id}-${String(change.rev)}`,
        JSON.stringify(fields),
        change.id,
        change.rev,
        id,
      ]);
  }

  retireNode(id: string): void {
    const change = this.changeSet();
    this.db
      .prepare(
        `UPDATE nodes
            SET status = 'retired', version = version + 1, change_set = ?, updated_rev = ?
          WHERE id = ?`,
      )
      .run([change.id, change.rev, id]);
  }

  setTaskState(task: string, state: string): void {
    this.db.prepare("UPDATE task_runtime SET state = ? WHERE task = ?").run([state, task]);
  }

  setTaskFeature(task: string, feature: string): void {
    this.db.prepare("UPDATE task_runtime SET feature = ? WHERE task = ?").run([feature, task]);
  }
}
