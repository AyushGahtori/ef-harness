import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import {
  boolField,
  featureSlug,
  normalizeLevel,
  numberField,
  parseFillStatus,
  stringField,
  stringList,
} from "./format.js";
import type {
  AttemptDraft,
  BudgetDraft,
  CandidateDraft,
  ConflictItem,
  DeferredItem,
  FeatureOutline,
  InboxDraft,
  MatrixPage,
  MatrixRow,
  NodeDraft,
  OutlineNode,
  OutlineSnapshot,
  PlanSnapshot,
  PlannedLeaf,
  ProjectedWave,
  ReadinessCounts,
  ReviewEdit,
  ReviewProposal,
  ReviewSettleResult,
  RuntimeDraft,
  RuntimePage,
  RuntimeQuery,
  RuntimeRow,
  StoredNode,
  TaskRuntimeDraft,
} from "./types.js";
import { PHASE0_STEPS } from "./types.js";

type SqlRow = Record<string, SQLInputValue>;

interface ChangeSet {
  readonly id: string;
  readonly rev: number;
}

const PHASE0 = new Set<string>(PHASE0_STEPS);

function splitSearchText(value: SQLInputValue | null): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./:]+/g, " ")
    .toLowerCase();
}

function asRow(value: unknown): SqlRow | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as SqlRow;
}

function textOf(row: SqlRow, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

function numberOf(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.length > 0) return Number(value);
  return 0;
}

function parseFields(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export class CanonicalStateDb {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  private depth = 0;
  private matrixCellTotal: number | undefined;
  private runtimeSnapshot: RuntimeRow[] | null = null;

  constructor(location = ":memory:") {
    this.db = new DatabaseSync(location);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.function("ef_search_text", { deterministic: true }, (value: SQLInputValue | null) => splitSearchText(value));
    const existing = this.one("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nodes'");
    if (!existing) {
      const schema = fs.readFileSync(canonicalAssetAbsolute("stateSql"), "utf8");
      this.db.exec(schema);
    }
    if (!this.one("SELECT value FROM meta WHERE key = 'last_rev'")) {
      this.run("INSERT INTO meta(key, value) VALUES ('last_rev', '0')");
    }
    this.run(
      "INSERT OR IGNORE INTO currencies(code, unit, scale) VALUES ('allowance:window', 'ppm of window share', 1000000)",
    );
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_canvas_attempts_task_n ON attempts(task, n);
      CREATE INDEX IF NOT EXISTS idx_canvas_candidates_task_recv ON candidates(task, received_at DESC, id);
      CREATE INDEX IF NOT EXISTS idx_canvas_matrix_cell ON nodes(id)
        WHERE json_extract(fields, '$.record_type') = 'matrix_cell';
    `);
  }

  close(): void {
    this.db.close();
  }

  getNode(id: string): StoredNode | null {
    const row = this.one(
      `SELECT id, kind, version, title, text, fields, status, feature, basis
         FROM nodes WHERE id = :id`,
      { id },
    );
    return row ? mapNode(row) : null;
  }

  setMeta(key: string, value: string): void {
    this.run(
      `INSERT INTO meta(key, value) VALUES (:key, :value)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      { key, value },
    );
  }

  getMeta(key: string): string | null {
    const row = this.one("SELECT value FROM meta WHERE key = :key", { key });
    return row ? textOf(row, "value") : null;
  }

  insertNodes(drafts: readonly NodeDraft[]): void {
    this.transaction(() => {
      const change = this.ensureChangeSet("canvas tabs seed");
      for (const draft of drafts) this.insertNodeInChange(draft, change);
    });
  }

  insertTaskRuntime(draft: TaskRuntimeDraft): void {
    this.transaction(() => this.insertTaskRuntimeUnlocked(draft));
  }

  insertAttempt(draft: AttemptDraft): void {
    this.transaction(() => this.insertAttemptUnlocked(draft));
  }

  insertBudget(draft: BudgetDraft): void {
    this.transaction(() => this.insertBudgetUnlocked(draft));
  }

  insertCandidate(draft: CandidateDraft): void {
    this.transaction(() => this.insertCandidateUnlocked(draft));
  }

  insertScopes(taskId: string, prefixes: readonly string[]): void {
    this.transaction(() => {
      const stmt = this.statement("INSERT INTO task_scopes(task, path_prefix) VALUES (:task, :prefix)");
      for (const prefix of prefixes) stmt.run({ task: taskId, prefix });
    });
  }

  insertInbox(draft: InboxDraft): void {
    this.run(
      `INSERT INTO inbox_items(id, kind, subject, priority, status, payload, created_at)
       VALUES (:id, :kind, :subject, :priority, :status, :payload, :created)`,
      {
        id: draft.id,
        kind: draft.kind,
        subject: draft.subject,
        priority: draft.priority,
        status: draft.status ?? "open",
        payload: JSON.stringify(draft.payload),
        created: Date.now(),
      },
    );
  }

  insertRuntimeRows(rows: readonly RuntimeDraft[]): void {
    this.transaction(() => {
      const featureDrafts: NodeDraft[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.featureId) || this.getNode(row.featureId)) continue;
        seen.add(row.featureId);
        featureDrafts.push({
          id: row.featureId,
          kind: "feature",
          title: row.featureTitle,
          fields: { feature: row.featureId },
        });
      }
      if (featureDrafts.length > 0) this.insertNodes(featureDrafts);
      this.insertNodes(
        rows.map((row) => ({
          id: row.id,
          kind: "task" as const,
          title: row.title,
          fields: { feature: row.featureId, wave: row.wave },
        })),
      );
      for (const row of rows) {
        const attemptId = row.agentId.length > 0 ? row.agentId : `attempt-${row.id}`;
        this.insertTaskRuntime({
          taskId: row.id,
          featureId: row.featureId,
          state: row.lane,
          level: row.tier,
        });
        this.insertAttempt({
          id: attemptId,
          taskId: row.id,
          n: row.retries + 1,
          runtime: "worker",
          model: row.model,
          startedAt: 1_000,
          endedAt: 1_000 + row.elapsedMs,
        });
        if (row.costMicroUsd > 0) {
          this.insertBudget({ scopeId: row.id, currency: "usd", spentUnits: row.costMicroUsd });
        }
        if (row.windowUnits > 0) {
          this.insertBudget({ scopeId: row.id, currency: "allowance:window", spentUnits: row.windowUnits });
        }
        if (row.mergeSha.length > 0) {
          this.insertCandidate({
            id: `cand-${row.id}`,
            taskId: row.id,
            attemptId,
            commitSha: row.mergeSha,
            receivedAt: 1_000 + row.elapsedMs,
          });
        }
      }
      this.runtimeSnapshot = null;
    });
  }

  patchRuntimeStates(updates: readonly { readonly taskId: string; readonly state: string }[]): void {
    this.transaction(() => {
      const stmt = this.statement("UPDATE task_runtime SET state = :state WHERE task = :task");
      const lanes = new Map<string, string>();
      for (const update of updates) {
        stmt.run({ state: update.state, task: update.taskId });
        lanes.set(update.taskId, update.state);
      }
      if (this.runtimeSnapshot && lanes.size > 0) {
        this.runtimeSnapshot = this.runtimeSnapshot.map((row) =>
          lanes.has(row.taskId) ? { ...row, lane: lanes.get(row.taskId) ?? row.lane } : row,
        );
      }
    });
  }

  readOutline(): OutlineSnapshot {
    const rows = this.all(
      `SELECT id, kind, version, title, text, fields, status, feature, basis
         FROM nodes
        WHERE status IN ('draft', 'active')
          AND NOT (
            kind = 'spec_item'
            AND json_extract(fields, '$.record_type') IN ('matrix_cell', 'universal_rule', 'matrix_exception')
          )
        ORDER BY id`,
    ).map(mapNode);
    return assembleOutline(rows, this.readConflicts(), this.countMustAsk());
  }

  readConflicts(): ConflictItem[] {
    const items: ConflictItem[] = [];
    for (const row of this.all(
      `SELECT id, subject, payload FROM inbox_items
        WHERE kind = 'conflict' AND status = 'open'
        ORDER BY priority DESC, created_at, id`,
    )) {
      const payload = parseFields(textOf(row, "payload"));
      items.push({
        id: textOf(row, "id"),
        summary: stringField(payload, "summary") ?? textOf(row, "subject"),
        cellIds: stringArray(payload.cell_ids),
        decisionIds: stringArray(payload.decision_ids),
      });
    }
    for (const row of this.all(
      `SELECT src, dst FROM edges WHERE type = 'contradicts' AND valid_to_rev IS NULL ORDER BY src, dst`,
    )) {
      const src = textOf(row, "src");
      const dst = textOf(row, "dst");
      items.push({
        id: `edge:${src}:${dst}`,
        summary: `contradicts ${src} ${dst}`,
        cellIds: [src, dst].filter((id) => id.startsWith("cell:")),
        decisionIds: [src, dst].filter((id) => !id.startsWith("cell:")),
      });
    }
    return items;
  }

  readiness(): ReadinessCounts {
    return this.readinessUnsafe();
  }

  readMatrixCollapsed(): MatrixRow[] {
    return this.all(
      `SELECT id, title, text, fields FROM nodes
        WHERE kind = 'spec_item' AND status = 'active'
          AND json_extract(fields, '$.record_type') IN ('universal_rule', 'matrix_exception')
        ORDER BY json_extract(fields, '$.matrix_id'), id`,
    ).map(mapMatrixRow);
  }

  readMatrixRawPage(offset: number, limit: number): MatrixPage {
    if (this.matrixCellTotal === undefined) {
      const totalRow = this.one(
        `SELECT COUNT(*) AS n FROM nodes
          WHERE kind = 'spec_item' AND status = 'active'
            AND json_extract(fields, '$.record_type') = 'matrix_cell'`,
      );
      this.matrixCellTotal = totalRow ? numberOf(totalRow, "n") : 0;
    }
    const rows = this.all(
      `SELECT id, title, text, fields FROM nodes
        WHERE kind = 'spec_item' AND status = 'active'
          AND json_extract(fields, '$.record_type') = 'matrix_cell'
        ORDER BY id
        LIMIT :limit OFFSET :offset`,
      { limit, offset },
    ).map(mapMatrixRow);
    return { total: this.matrixCellTotal, rows };
  }

  listProposals(): ReviewProposal[] {
    return this.all(
      `SELECT n.id, n.title, n.text, n.fields, n.feature, f.title AS feature_title
         FROM nodes n
         LEFT JOIN nodes f ON f.id = n.feature
        WHERE n.kind = 'spec_item' AND n.status = 'draft' AND n.basis = 'proposed'
          AND json_extract(n.fields, '$.risk') = 'medium'
          AND json_extract(n.fields, '$.review_status') = 'proposed'
        ORDER BY n.feature, json_extract(n.fields, '$.matrix_id'), n.id`,
    ).map((row) => {
      const fields = parseFields(textOf(row, "fields"));
      const featureId = textOf(row, "feature");
      return {
        cellId: textOf(row, "id"),
        featureId,
        featureTitle: textOf(row, "feature_title") || featureId,
        matrixId: stringField(fields, "matrix_id") ?? "",
        requirementId: textOf(row, "id"),
        title: textOf(row, "title"),
        earsText: textOf(row, "text"),
        oracleSketch: stringField(fields, "oracle_sketch") ?? "",
        risk: "medium" as const,
        basis: "proposed" as const,
      };
    });
  }

  applyReview(command: {
    readonly approve: readonly string[];
    readonly reject: readonly string[];
    readonly edits: readonly ReviewEdit[];
  }): ReviewSettleResult {
    return this.transaction(() => {
      const change = this.ensureChangeSet("review proposals");
      for (const id of command.approve) {
        const node = this.requireNode(id);
        this.rewrite(node, node.text, "active", { ...node.fields, basis: "explicit", review_status: "settled" }, change);
      }
      for (const edit of command.edits) {
        const node = this.requireNode(edit.cellId);
        const ears = edit.earsText.trim();
        const oracle = edit.oracleSketch.trim();
        this.rewrite(
          node,
          ears,
          "active",
          { ...node.fields, basis: "explicit", review_status: "settled", ears_text: ears, oracle_sketch: oracle },
          change,
        );
      }
      for (const id of command.reject) {
        const node = this.requireNode(id);
        this.rewrite(node, node.text, "superseded", { ...node.fields, review_status: "rejected" }, change);
        this.insertNodeInChange(
          {
            id: `CMT-${id}`,
            kind: "comment",
            title: `Clarification for ${id}`,
            text: `Clarify ${node.title}. The proposed requirement was rejected. Replace it with one EARS sentence and a concrete oracle sketch.`,
            status: "active",
            fields: { feature: node.feature ?? "" },
          },
          change,
        );
      }
      return {
        approved: command.approve,
        rejected: command.reject,
        edited: command.edits.map((edit) => edit.cellId),
        readiness: this.readinessUnsafe(),
      };
    });
  }

  readPlan(): PlanSnapshot {
    const mode = this.getMeta("plan_mode") === "revision" ? "revision" : "first";
    const delta = this.getNode("plan-delta");
    const nodes = this.all(
      `SELECT id, kind, version, title, text, fields, status, feature, basis
         FROM nodes WHERE status = 'active' AND kind IN ('task', 'feature', 'decision', 'plan')`,
    ).map(mapNode);
    const titles = new Map(nodes.filter((node) => node.kind === "feature").map((node) => [node.id, node.title]));
    const scopes = new Map<string, string[]>();
    for (const row of this.all("SELECT task, path_prefix FROM task_scopes ORDER BY task, path_prefix")) {
      const task = textOf(row, "task");
      const list = scopes.get(task);
      if (list) list.push(textOf(row, "path_prefix"));
      else scopes.set(task, [textOf(row, "path_prefix")]);
    }
    const planned: PlannedLeaf[] = [];
    const projected: ProjectedWave[] = [];
    const deferred: DeferredItem[] = [];
    const chosen: OutlineNode[] = [];
    for (const node of nodes) {
      if (node.kind === "task") {
        const band = stringField(node.fields, "band");
        if (band !== "phase0" && band !== "wave1") continue;
        const step = stringField(node.fields, "step");
        const featureId = node.feature ?? stringField(node.fields, "feature") ?? "";
        planned.push({
          id: node.id,
          title: node.title,
          featureId,
          featureTitle: titles.get(featureId) ?? featureId,
          band,
          step: step !== null && PHASE0.has(step) ? (step as PlannedLeaf["step"]) : null,
          writeScope: scopes.get(node.id) ?? stringList(node.fields, "write_scope"),
          balancedLevel: normalizeLevel(stringField(node.fields, "balanced_level")),
          safetyFloor: normalizeLevel(stringField(node.fields, "safety_floor")),
          criticalPath: boolField(node.fields, "critical_path"),
          juniorCostMicroUsd: numberField(node.fields, "junior_cost_micro_usd") ?? 0,
          durationMinutes: numberField(node.fields, "duration_minutes") ?? 0,
        });
      } else if (node.kind === "feature" && stringField(node.fields, "band") === "projected") {
        const wave = numberField(node.fields, "wave") ?? 0;
        projected.push({
          id: node.id,
          title: node.title,
          wave,
          taskMin: numberField(node.fields, "task_min") ?? 0,
          taskMax: numberField(node.fields, "task_max") ?? 0,
          costMinMicroUsd: numberField(node.fields, "cost_min_micro") ?? 0,
          costMaxMicroUsd: numberField(node.fields, "cost_max_micro") ?? 0,
        });
      } else if (node.kind === "decision" && boolField(node.fields, "deferred")) {
        deferred.push({
          id: node.id,
          label: stringField(node.fields, "criterion_label") ?? node.title,
          reason: stringField(node.fields, "deferred_reason") ?? node.text,
          revisitWave: stringField(node.fields, "revisit_wave") ?? "",
        });
      } else if (
        node.kind === "decision" &&
        (node.basis === "delegated" || node.basis === "defaulted") &&
        !boolField(node.fields, "deferred")
      ) {
        chosen.push(toOutline(node));
      }
    }
    planned.sort((left, right) => {
      if (left.band !== right.band) return left.band === "phase0" ? -1 : 1;
      const stepOrder = (left.step ?? "").localeCompare(right.step ?? "");
      if (stepOrder !== 0) return stepOrder;
      return left.id.localeCompare(right.id);
    });
    projected.sort((left, right) => left.wave - right.wave || left.id.localeCompare(right.id));
    return {
      mode,
      deltaText: delta?.text ?? "",
      planned,
      projected,
      chosenForYou: chosen,
      deferred,
      conflicts: this.readConflicts(),
      mustAsk: this.countMustAsk(),
    };
  }

  readRuntimePage(query: RuntimeQuery): RuntimePage {
    let rows = this.loadRuntimeSnapshot(query.nowMs);
    const filter = query.filter.trim().toLowerCase();
    if (filter.length > 0) {
      rows = rows.filter((row) => runtimeMatchesFilter(row, filter));
    }
    rows = sortRuntimeRows(rows, query.sort, query.direction);
    const total = rows.length;
    return { total, rows: rows.slice(query.offset, query.offset + query.limit) };
  }

  private loadRuntimeSnapshot(nowMs: number): RuntimeRow[] {
    if (this.runtimeSnapshot) return this.runtimeSnapshot;
    this.runtimeSnapshot = this.all(`${RUNTIME_SELECT} ${RUNTIME_JOINS}`, { now: nowMs }).map(mapRuntime);
    return this.runtimeSnapshot;
  }

  private readinessUnsafe(): ReadinessCounts {
    const row = this.one(
      `SELECT
         (SELECT COUNT(*) FROM nodes
           WHERE kind = 'spec_item' AND status = 'draft' AND basis = 'proposed'
             AND json_extract(fields, '$.risk') = 'medium'
             AND json_extract(fields, '$.review_status') = 'proposed') AS pending,
         (SELECT COUNT(*) FROM nodes
           WHERE kind = 'spec_item' AND status = 'active' AND basis = 'explicit'
             AND json_extract(fields, '$.review_status') = 'settled') AS settled,
         (SELECT COUNT(*) FROM inbox_items WHERE kind = 'conflict' AND status = 'open') AS inbox_conflicts,
         (SELECT COUNT(*) FROM edges WHERE type = 'contradicts' AND valid_to_rev IS NULL) AS edge_conflicts,
         (SELECT COUNT(*) FROM nodes
           WHERE kind = 'decision' AND status IN ('draft', 'active') AND basis IS NULL
             AND json_extract(fields, '$.must_ask') = 1) AS must_ask`,
    );
    const pendingProposals = row ? numberOf(row, "pending") : 0;
    const conflicts = row ? numberOf(row, "inbox_conflicts") + numberOf(row, "edge_conflicts") : 0;
    const mustAsk = row ? numberOf(row, "must_ask") : 0;
    const explicitSettled = row ? numberOf(row, "settled") : 0;
    return {
      pendingProposals,
      conflicts,
      mustAsk,
      explicitSettled,
      isReady: pendingProposals === 0 && conflicts === 0 && mustAsk === 0,
    };
  }

  private countMustAsk(): number {
    const row = this.one(
      `SELECT COUNT(*) AS n FROM nodes
        WHERE kind = 'decision' AND status IN ('draft', 'active') AND basis IS NULL
          AND json_extract(fields, '$.must_ask') = 1`,
    );
    return row ? numberOf(row, "n") : 0;
  }

  private requireNode(id: string): StoredNode {
    const node = this.getNode(id);
    if (!node) throw new Error(`missing node ${id}`);
    return node;
  }

  private rewrite(
    node: StoredNode,
    text: string,
    status: string,
    fields: Record<string, unknown>,
    change: ChangeSet,
  ): void {
    this.matrixCellTotal = undefined;
    const encoded = JSON.stringify(fields);
    const hash = digest({ id: node.id, title: node.title, text, status, fields: encoded, rev: change.rev });
    this.run(
      `UPDATE nodes
          SET version = version + 1,
              content_hash = :hash,
              text = :text,
              fields = :fields,
              status = :status,
              change_set = :change_set,
              updated_rev = :rev
        WHERE id = :id`,
      { hash, text, fields: encoded, status, change_set: change.id, rev: change.rev, id: node.id },
    );
  }

  private insertNodeInChange(draft: NodeDraft, change: ChangeSet): void {
    const text = draft.text ?? "";
    const status = draft.status ?? "active";
    const fields = JSON.stringify(draft.fields ?? {});
    const hash = digest({ id: draft.id, title: draft.title, text, status, fields, rev: change.rev });
    this.run(
      `INSERT INTO nodes (id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev)
       VALUES (:id, :kind, 1, :hash, :title, :text, :fields, :status, :change_set, :rev, :rev)`,
      {
        id: draft.id,
        kind: draft.kind,
        hash,
        title: draft.title,
        text,
        fields,
        status,
        change_set: change.id,
        rev: change.rev,
      },
    );
    if (draft.kind === "spec_item" && (draft.fields?.record_type === "matrix_cell" || draft.id.startsWith("raw-"))) {
      this.matrixCellTotal = undefined;
    }
  }

  private insertTaskRuntimeUnlocked(draft: TaskRuntimeDraft): void {
    this.run(
      `INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev)
       VALUES (:task, :feature, :state, :level, 0, :rev)`,
      {
        task: draft.taskId,
        feature: draft.featureId,
        state: draft.state,
        level: draft.level,
        rev: Math.max(1, this.currentRev()),
      },
    );
  }

  private insertAttemptUnlocked(draft: AttemptDraft): void {
    this.run(
      `INSERT INTO attempts(id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at, ended_at)
       VALUES (:id, :task, :n, 0, 1, :runtime, :model, 'api', :base, 'accepted', :started, :ended)`,
      {
        id: draft.id,
        task: draft.taskId,
        n: draft.n,
        runtime: draft.runtime,
        model: draft.model,
        base: "0".repeat(40),
        started: draft.startedAt,
        ended: draft.endedAt,
      },
    );
  }

  private insertBudgetUnlocked(draft: BudgetDraft): void {
    this.run(
      `INSERT INTO budgets(scope_kind, scope_id, currency, limit_units, reserved_units, spent_units, closed)
       VALUES ('task', :scope, :currency, :limit, 0, :spent, 0)`,
      {
        scope: draft.scopeId,
        currency: draft.currency,
        limit: Math.max(draft.spentUnits, 0),
        spent: draft.spentUnits,
      },
    );
  }

  private insertCandidateUnlocked(draft: CandidateDraft): void {
    this.run(
      `INSERT INTO candidates(id, task, attempt, epoch, commit_sha, payload, received_at)
       VALUES (:id, :task, :attempt, 0, :sha, '{}', :at)`,
      {
        id: draft.id,
        task: draft.taskId,
        attempt: draft.attemptId,
        sha: draft.commitSha,
        at: draft.receivedAt,
      },
    );
  }

  private ensureChangeSet(summary: string): ChangeSet {
    const rev = this.nextRev();
    const id = `cs-tabs-${rev}`;
    this.run(
      `INSERT INTO change_sets(id, rev, origin, author, created_at, summary)
       VALUES (:id, :rev, 'planner', 'canvas-tabs', :created, :summary)`,
      { id, rev, created: Date.now(), summary },
    );
    return { id, rev };
  }

  private nextRev(): number {
    const next = this.currentRev() + 1;
    this.run(
      `INSERT INTO meta(key, value) VALUES ('last_rev', :value)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      { value: String(next) },
    );
    return next;
  }

  private currentRev(): number {
    const row = this.one("SELECT value FROM meta WHERE key = 'last_rev'");
    return row ? numberOf(row, "value") : 0;
  }

  private transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth += 1;
    this.db.exec("BEGIN");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  private statement(sql: string): ReturnType<DatabaseSync["prepare"]> {
    const cached = this.statements.get(sql);
    if (cached) return cached;
    const prepared = this.db.prepare(sql);
    this.statements.set(sql, prepared);
    return prepared;
  }

  private run(sql: string, params: Record<string, SQLInputValue> = {}): void {
    this.statement(sql).run(params);
  }

  private one(sql: string, params: Record<string, SQLInputValue> = {}): SqlRow | undefined {
    return asRow(this.statement(sql).get(params));
  }

  private all(sql: string, params: Record<string, SQLInputValue> = {}): SqlRow[] {
    const rows = this.statement(sql).all(params);
    const mapped: SqlRow[] = [];
    for (const row of rows) {
      const typed = asRow(row);
      if (typed) mapped.push(typed);
    }
    return mapped;
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mapNode(row: SqlRow): StoredNode {
  const fields = parseFields(textOf(row, "fields"));
  const feature = row.feature;
  const basis = row.basis;
  return {
    id: textOf(row, "id"),
    kind: textOf(row, "kind"),
    version: numberOf(row, "version"),
    title: textOf(row, "title"),
    text: textOf(row, "text"),
    status: textOf(row, "status"),
    feature: feature === null || feature === undefined ? null : String(feature),
    basis: basis === null || basis === undefined ? null : String(basis),
    fields,
  };
}

function toOutline(node: StoredNode): OutlineNode {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    text: node.text,
    feature: node.feature,
    basis: node.basis,
    status: node.status,
    fields: node.fields,
  };
}

function mapMatrixRow(row: SqlRow): MatrixRow {
  const fields = parseFields(textOf(row, "fields"));
  const record = stringField(fields, "record_type");
  return {
    id: textOf(row, "id"),
    matrixId: stringField(fields, "matrix_id") ?? "",
    title: textOf(row, "title"),
    text: textOf(row, "text"),
    recordType: record === "universal_rule" || record === "matrix_exception" ? record : "matrix_cell",
    status: parseFillStatus(stringField(fields, "status")),
    axisA: stringField(fields, "axis_a") ?? "",
    axisB: stringField(fields, "axis_b") ?? "",
  };
}

function mapRuntime(row: SqlRow): RuntimeRow {
  return {
    taskId: textOf(row, "task_id"),
    title: textOf(row, "title"),
    agentId: textOf(row, "agent_id"),
    featureId: textOf(row, "feature_id"),
    featureTitle: textOf(row, "feature_title"),
    wave: numberOf(row, "wave"),
    lane: textOf(row, "lane"),
    tier: textOf(row, "tier"),
    model: textOf(row, "model"),
    retries: numberOf(row, "retries"),
    elapsedMs: numberOf(row, "elapsed_ms"),
    costMicroUsd: numberOf(row, "cost_micro"),
    windowUnits: numberOf(row, "window_units"),
    mergeSha: textOf(row, "merge_sha"),
  };
}

function runtimeMatchesFilter(row: RuntimeRow, filter: string): boolean {
  const haystack = [
    row.title,
    row.featureTitle,
    row.lane,
    row.tier,
    row.model,
    row.agentId,
    row.mergeSha,
    row.taskId,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(filter);
}

function sortRuntimeRows(
  rows: readonly RuntimeRow[],
  sort: RuntimeQuery["sort"],
  direction: RuntimeQuery["direction"],
): RuntimeRow[] {
  const copy = [...rows];
  const factor = direction === "desc" ? -1 : 1;
  copy.sort((left, right) => {
    let order = 0;
    switch (sort) {
      case "agent":
        order = left.agentId.localeCompare(right.agentId) || left.title.localeCompare(right.title);
        break;
      case "feature":
        order = left.featureTitle.localeCompare(right.featureTitle) || left.taskId.localeCompare(right.taskId);
        break;
      case "wave":
        order = left.wave - right.wave || left.taskId.localeCompare(right.taskId);
        break;
      case "lane":
        order = left.lane.localeCompare(right.lane) || left.taskId.localeCompare(right.taskId);
        break;
      case "tier":
        order = left.tier.localeCompare(right.tier) || left.taskId.localeCompare(right.taskId);
        break;
      case "retries":
        order = left.retries - right.retries || left.taskId.localeCompare(right.taskId);
        break;
      case "elapsed":
        order = left.elapsedMs - right.elapsedMs || left.taskId.localeCompare(right.taskId);
        break;
      case "cost":
        order = left.costMicroUsd - right.costMicroUsd || left.taskId.localeCompare(right.taskId);
        break;
      case "sha":
        order = left.mergeSha.localeCompare(right.mergeSha) || left.taskId.localeCompare(right.taskId);
        break;
      default:
        order = left.taskId.localeCompare(right.taskId);
    }
    return order * factor;
  });
  return copy;
}

const RUNTIME_SELECT = `SELECT
  n.id AS task_id,
  n.title AS title,
  tr.feature AS feature_id,
  COALESCE(f.title, tr.feature) AS feature_title,
  COALESCE(CAST(json_extract(n.fields, '$.wave') AS INTEGER), 0) AS wave,
  tr.state AS lane,
  tr.level AS tier,
  COALESCE(a.id, n.id) AS agent_id,
  COALESCE(a.model, '') AS model,
  CASE WHEN a.n IS NULL THEN 0 ELSE a.n - 1 END AS retries,
  CASE WHEN a.started_at IS NULL THEN 0 ELSE COALESCE(a.ended_at, :now) - a.started_at END AS elapsed_ms,
  COALESCE(b.spent_units, 0) AS cost_micro,
  COALESCE(w.spent_units, 0) AS window_units,
  COALESCE(c.commit_sha, '') AS merge_sha,
  COUNT(*) OVER () AS total_rows`;

const RUNTIME_JOINS = `FROM task_runtime tr
  JOIN nodes n ON n.id = tr.task
  LEFT JOIN nodes f ON f.id = tr.feature
  LEFT JOIN (
    SELECT a1.task, a1.id, a1.model, a1.n, a1.started_at, a1.ended_at
      FROM attempts a1
      INNER JOIN (
        SELECT task, MAX(n) AS max_n FROM attempts GROUP BY task
      ) latest ON latest.task = a1.task AND latest.max_n = a1.n
  ) a ON a.task = tr.task
  LEFT JOIN budgets b ON b.scope_kind = 'task' AND b.scope_id = tr.task AND b.currency = 'usd'
  LEFT JOIN budgets w ON w.scope_kind = 'task' AND w.scope_id = tr.task AND w.currency = 'allowance:window'
  LEFT JOIN (
    SELECT task, commit_sha, ROW_NUMBER() OVER (PARTITION BY task ORDER BY received_at DESC, id ASC) AS rn
      FROM candidates
  ) c ON c.task = tr.task AND c.rn = 1`;

function assembleOutline(nodes: readonly StoredNode[], conflicts: readonly ConflictItem[], mustAsk: number): OutlineSnapshot {
  let overview: OutlineNode | null = null;
  let projectKind: "ui" | "cli" = "ui";
  const decisions: OutlineNode[] = [];
  const chosen: OutlineNode[] = [];
  const rules: OutlineNode[] = [];
  const features = new Map<string, MutableFeature>();

  const ensure = (id: string, title: string, fields: Readonly<Record<string, unknown>>): MutableFeature => {
    const existing = features.get(id);
    if (existing) {
      if (title.length > 0 && existing.title === id) existing.title = title;
      return existing;
    }
    const created: MutableFeature = {
      id,
      title: title.length > 0 ? title : id,
      slug: featureSlug(id, fields),
      viewPath: stringField(fields, "view_path"),
      requirements: [],
      contracts: [],
      screens: [],
      seams: [],
      research: [],
      cliCommands: [],
      exitCodes: [],
    };
    features.set(id, created);
    return created;
  };

  for (const node of nodes) {
    if (node.kind === "feature") {
      const bucket = ensure(node.id, node.title, node.fields);
      bucket.title = node.title;
      bucket.slug = featureSlug(node.id, node.fields);
      bucket.viewPath = stringField(node.fields, "view_path");
      continue;
    }
    if (node.kind === "arch_node" && stringField(node.fields, "role") === "system_overview") {
      overview = toOutline(node);
      if (stringField(node.fields, "project_kind") === "cli") projectKind = "cli";
      continue;
    }
    if (node.kind === "decision") {
      if (boolField(node.fields, "deferred")) continue;
      const outline = toOutline(node);
      decisions.push(outline);
      if (node.basis === "delegated" || node.basis === "defaulted") chosen.push(outline);
      continue;
    }
    if (node.kind === "rule") {
      rules.push(toOutline(node));
      continue;
    }
    const featureId = node.feature ?? stringField(node.fields, "feature");
    if (!featureId) continue;
    const bucket = ensure(featureId, featureId, {});
    const outline = toOutline(node);
    if (node.kind === "contract") bucket.contracts.push(outline);
    else if (node.kind === "research_fact") bucket.research.push(outline);
    else if (node.kind === "arch_node" && stringField(node.fields, "role") === "screen_spec") bucket.screens.push(outline);
    else if (node.kind === "arch_node" && stringField(node.fields, "role") === "seam") bucket.seams.push(outline);
    else if (node.kind === "spec_item") {
      const record = stringField(node.fields, "record_type") ?? "requirement";
      if (record === "cli_command") bucket.cliCommands.push(outline);
      else if (record === "exit_code") bucket.exitCodes.push(outline);
      else if (record === "requirement") bucket.requirements.push(outline);
    }
  }

  const featureList: FeatureOutline[] = [...features.values()]
    .map((feature) => ({
      id: feature.id,
      title: feature.title,
      slug: feature.slug,
      viewPath: feature.viewPath,
      requirements: feature.requirements,
      contracts: feature.contracts,
      screens: feature.screens,
      seams: feature.seams,
      research: feature.research,
      cliCommands: feature.cliCommands,
      exitCodes: feature.exitCodes,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    projectKind,
    overview,
    decisions,
    chosenForYou: chosen,
    features: featureList,
    rules: rules.sort((left, right) => left.id.localeCompare(right.id)),
    conflicts,
    mustAsk,
  };
}

interface MutableFeature {
  id: string;
  title: string;
  slug: string;
  viewPath: string | null;
  requirements: OutlineNode[];
  contracts: OutlineNode[];
  screens: OutlineNode[];
  seams: OutlineNode[];
  research: OutlineNode[];
  cliCommands: OutlineNode[];
  exitCodes: OutlineNode[];
}
