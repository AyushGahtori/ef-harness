import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { insertOutboxPayload, withImmediateTransaction } from "./graph.js";
import { queryActiveCriteria, queryCounts, sqlNumber } from "./sql.js";
import { emptyForces, SilentDenominatorJumpError } from "./types.js";
import type {
  DenominatorDeltaRecord,
  DenominatorExplanation,
  DenominatorGroup,
  DenominatorSnapshot,
} from "./types.js";

interface SqlRow {
  [key: string]: string | number | bigint | null | undefined;
}

function asRow(value: unknown): SqlRow {
  if (!value || typeof value !== "object") throw new Error("expected a SQL row");
  return value as SqlRow;
}

function cellNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`expected a number for ${key}`);
}

function cellString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (value == null) return "";
  throw new Error(`expected a string for ${key}`);
}

function itemWord(count: number): string {
  return count === 1 ? "item" : "items";
}

function formatExplanation(input: {
  previousDenominator: number;
  activeDenominator: number;
  settledThisTurn: number;
  addedTotal: number;
  removedTotal: number;
  addedByScope: readonly DenominatorGroup[];
  removedByScope: readonly DenominatorGroup[];
  trigger: string;
}): string {
  const added = input.addedByScope;
  const removed = input.removedByScope;
  if (input.settledThisTurn > 0 && input.addedTotal > 0 && input.removedTotal === 0) {
    const groups = added.map((group) => `${group.count} ${group.label}`).join(", ");
    return `${input.settledThisTurn} settled · +${input.addedTotal} new items unlocked (${groups})`;
  }
  if (input.addedTotal > 0 && input.removedTotal === 0 && added.length === 1) {
    const group = added[0];
    if (!group) throw new Error("missing added scope group");
    const label = group.label.toLowerCase();
    return `Total items changed ${input.previousDenominator} → ${input.activeDenominator} (+${group.count} ${label} ${itemWord(group.count)} added after ${input.trigger})`;
  }
  if (input.removedTotal > 0 && input.addedTotal === 0 && removed.length === 1) {
    const group = removed[0];
    if (!group) throw new Error("missing removed scope group");
    const label = group.label.toLowerCase();
    return `Total items changed ${input.previousDenominator} → ${input.activeDenominator} (-${group.count} ${label} ${itemWord(group.count)} marked not applicable after ${input.trigger})`;
  }
  return `Total items changed ${input.previousDenominator} → ${input.activeDenominator} after ${input.trigger}`;
}

export class DenominatorDeltaExplainer {
  constructor(private readonly db: DatabaseSync) {}

  recordBaseline(input: { workItemId: string; turnId: string }): DenominatorSnapshot {
    return withImmediateTransaction(this.db, () => {
      const snapshot = this.currentSnapshot(input.workItemId, input.turnId);
      this.persistSnapshot(snapshot);
      return snapshot;
    });
  }

  explainTurn(input: { workItemId: string; turnId: string; trigger: string }): DenominatorExplanation {
    return withImmediateTransaction(this.db, () => this.writeExplanation(input));
  }

  writeExplanation(input: { workItemId: string; turnId: string; trigger: string }): DenominatorExplanation {
    const previous = this.latestSnapshot(input.workItemId);
    if (!previous) {
      throw new SilentDenominatorJumpError(
        `No denominator snapshot exists for ${input.workItemId}. Record a baseline before explaining a turn.`,
      );
    }
    const snapshot = this.currentSnapshot(input.workItemId, input.turnId);
    const diff = this.diff(input.workItemId, previous.criterionIds);
    const settledThisTurn = sqlNumber(
      this.db,
      "SELECT :current - :previous AS settled_delta",
      { current: snapshot.settledTotal, previous: previous.settledTotal },
      "settled_delta",
    );
    const changed = diff.addedTotal > 0 || diff.removedTotal > 0;
    let delta: DenominatorDeltaRecord | null = null;
    if (changed) {
      const explanation = formatExplanation({
        previousDenominator: previous.activeDenominator,
        activeDenominator: snapshot.activeDenominator,
        settledThisTurn,
        addedTotal: diff.addedTotal,
        removedTotal: diff.removedTotal,
        addedByScope: diff.addedByScope,
        removedByScope: diff.removedByScope,
        trigger: input.trigger,
      });
      delta = {
        kind: "denominator",
        workItemId: input.workItemId,
        turnId: input.turnId,
        previousDenominator: previous.activeDenominator,
        activeDenominator: snapshot.activeDenominator,
        addedCriterionIds: diff.addedIds,
        removedCriterionIds: diff.removedIds,
        addedByScope: diff.addedByScope,
        removedByScope: diff.removedByScope,
        trigger: input.trigger,
        explanation,
        settledThisTurn,
      };
      this.persistDelta(delta);
    }
    this.persistSnapshot(snapshot);
    return { changed, snapshot, delta };
  }

  writeReopen(input: {
    workItemId: string;
    turnId: string;
    reason: string;
    reopenedDecisionIds: readonly string[];
  }): DenominatorDeltaRecord {
    const previous = this.latestSnapshot(input.workItemId);
    if (!previous) {
      throw new SilentDenominatorJumpError(
        `No denominator snapshot exists for ${input.workItemId}. Record a baseline before reopening.`,
      );
    }
    const snapshot = this.currentSnapshot(input.workItemId, input.turnId);
    const settledThisTurn = sqlNumber(
      this.db,
      "SELECT :current - :previous AS settled_delta",
      { current: snapshot.settledTotal, previous: previous.settledTotal },
      "settled_delta",
    );
    const count = input.reopenedDecisionIds.length;
    const noun = count === 1 ? "criterion" : "criteria";
    const delta: DenominatorDeltaRecord = {
      kind: "reopen",
      workItemId: input.workItemId,
      turnId: input.turnId,
      previousDenominator: previous.activeDenominator,
      activeDenominator: snapshot.activeDenominator,
      addedCriterionIds: [],
      removedCriterionIds: [],
      addedByScope: [],
      removedByScope: [],
      trigger: input.reason,
      explanation: `${count} derived ${noun} reopened after a premise was superseded (${input.reason}). Scope returned to discovering.`,
      settledThisTurn,
      reopenReason: input.reason,
      reopenedDecisionIds: input.reopenedDecisionIds,
    };
    this.persistDelta(delta);
    this.persistSnapshot(snapshot);
    return delta;
  }

  assertExplained(workItemId: string): void {
    const snapshot = this.latestSnapshot(workItemId);
    const current = queryCounts(this.db, {
      workItemId,
      scopeId: null,
      forces: emptyForces(),
    }).activeDenominator;
    if (!snapshot) {
      throw new SilentDenominatorJumpError(
        `No denominator snapshot exists for ${workItemId}. Record a baseline before changing readiness.`,
      );
    }
    if (snapshot.activeDenominator !== current) {
      throw new SilentDenominatorJumpError(
        `activeDenominator changed ${snapshot.activeDenominator} → ${current} without a DenominatorDelta for ${workItemId}.`,
      );
    }
  }

  latestSnapshot(workItemId: string): DenominatorSnapshot | null {
    return this.latestPayload(workItemId, "discovery.denominator_snapshot") as DenominatorSnapshot | null;
  }

  latestDelta(workItemId: string): DenominatorDeltaRecord | null {
    return this.latestPayload(workItemId, "discovery.denominator_delta") as DenominatorDeltaRecord | null;
  }

  private currentSnapshot(workItemId: string, turnId: string): DenominatorSnapshot {
    const counts = queryCounts(this.db, { workItemId, scopeId: null, forces: emptyForces() });
    const active = queryActiveCriteria(this.db, { workItemId, scopeId: null, forces: emptyForces() });
    const scopeIds = [...new Set(active.map((row) => row.scopeId))].sort();
    return {
      workItemId,
      turnId,
      activeDenominator: counts.activeDenominator,
      settledTotal: counts.settledTotal,
      scopeIds,
      criterionIds: active.map((row) => row.id),
    };
  }

  private diff(workItemId: string, previousIds: readonly string[]): {
    addedByScope: DenominatorGroup[];
    removedByScope: DenominatorGroup[];
    addedIds: string[];
    removedIds: string[];
    addedTotal: number;
    removedTotal: number;
  } {
    this.db.exec("DROP TABLE IF EXISTS readiness_prev_ids");
    this.db.exec("DROP TABLE IF EXISTS readiness_now");
    this.db.exec("CREATE TEMP TABLE readiness_prev_ids (id TEXT PRIMARY KEY)");
    this.db.exec("CREATE TEMP TABLE readiness_now (id TEXT PRIMARY KEY, scope_id TEXT, label TEXT)");
    try {
      const insertPrev = this.db.prepare("INSERT INTO readiness_prev_ids(id) VALUES (?)");
      for (const id of previousIds) insertPrev.run(id);
      const active = queryActiveCriteria(this.db, { workItemId, scopeId: null, forces: emptyForces() });
      const insertNow = this.db.prepare("INSERT INTO readiness_now(id, scope_id, label) VALUES (?, ?, ?)");
      for (const row of active) insertNow.run(row.id, row.scopeId, row.label);
      const addedByScope = this.group(
        `SELECT scope_id, label, count(*) AS n
           FROM readiness_now
          WHERE id NOT IN (SELECT id FROM readiness_prev_ids)
          GROUP BY scope_id, label
          ORDER BY n DESC, label ASC`,
      );
      const removedByScope = this.group(
        `SELECT coalesce(n.fields ->> '$.scopeId', '') AS scope_id,
                coalesce(n.fields ->> '$.scopeLabel', n.fields ->> '$.scopeId', 'items') AS label,
                count(*) AS n
           FROM readiness_prev_ids p
           JOIN nodes n ON n.id = p.id
          WHERE p.id NOT IN (SELECT id FROM readiness_now)
          GROUP BY 1, 2
          ORDER BY n DESC, label ASC`,
      );
      return {
        addedByScope,
        removedByScope,
        addedIds: this.ids(
          "SELECT id FROM readiness_now WHERE id NOT IN (SELECT id FROM readiness_prev_ids) ORDER BY id",
        ),
        removedIds: this.ids(
          "SELECT id FROM readiness_prev_ids WHERE id NOT IN (SELECT id FROM readiness_now) ORDER BY id",
        ),
        addedTotal: this.count(
          "SELECT count(*) AS n FROM readiness_now WHERE id NOT IN (SELECT id FROM readiness_prev_ids)",
        ),
        removedTotal: this.count(
          "SELECT count(*) AS n FROM readiness_prev_ids WHERE id NOT IN (SELECT id FROM readiness_now)",
        ),
      };
    } finally {
      this.db.exec("DROP TABLE IF EXISTS readiness_prev_ids");
      this.db.exec("DROP TABLE IF EXISTS readiness_now");
    }
  }

  private group(sql: string): DenominatorGroup[] {
    return this.db
      .prepare(sql)
      .all()
      .map((value) => {
        const row = asRow(value);
        return {
          scopeId: cellString(row, "scope_id"),
          label: cellString(row, "label"),
          count: cellNumber(row, "n"),
        };
      });
  }

  private ids(sql: string): string[] {
    return this.db
      .prepare(sql)
      .all()
      .map((value) => cellString(asRow(value), "id"));
  }

  private count(sql: string): number {
    return cellNumber(asRow(this.db.prepare(sql).get()), "n");
  }

  private persistSnapshot(snapshot: DenominatorSnapshot): void {
    insertOutboxPayload(this.db, {
      id: `discovery.denominator_snapshot:${snapshot.workItemId}:${snapshot.turnId}:${randomUUID()}`,
      type: "discovery.denominator_snapshot",
      subject: snapshot.workItemId,
      rev: null,
      payload: snapshot,
    });
  }

  private persistDelta(delta: DenominatorDeltaRecord): void {
    insertOutboxPayload(this.db, {
      id: `discovery.denominator_delta:${delta.workItemId}:${delta.turnId}:${randomUUID()}`,
      type: "discovery.denominator_delta",
      subject: delta.workItemId,
      rev: null,
      payload: delta,
    });
  }

  private latestPayload(workItemId: string, type: string): unknown {
    const value = this.db
      .prepare(
        `SELECT payload FROM outbox WHERE type = ? AND subject = ? ORDER BY seq DESC LIMIT 1`,
      )
      .get(type, workItemId);
    if (!value || typeof value !== "object") return null;
    const payload = (value as Record<string, unknown>).payload;
    if (typeof payload !== "string") return null;
    return JSON.parse(payload) as unknown;
  }
}
