import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import { CANONICAL_IMPACT_WALK_SQL, CYCLE_SAFE_IMPACT_WALK_SQL, INTENT_GRAPH_SCHEMA_SQL } from "./sql.js";
import {
  IMPACT_MAX_DEPTH,
  type BoxRecord,
  type ImpactNode,
  type MisheardPair,
  type ProjectStage,
  type SeedEdge,
  type SeedNode,
  type SeedTask,
} from "./types.js";

const ACTIVE_STATES = new Set(["WORKING", "LEASED", "CODING"]);
const MERGED_STATES = new Set(["DONE", "MERGED_TO_FEATURE", "ACCEPTED"]);

interface VersionRow {
  readonly title: string;
  readonly text: string;
  readonly value: string;
  readonly status: string;
  readonly fields: string;
  readonly revisionSource: string;
}

export class IntentGraph {
  readonly db: DatabaseSync;
  mutationCount = 0;
  canonicalQueries = 0;
  cycleSafeQueries = 0;
  private readonly canonical;
  private readonly cycle;

  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec(INTENT_GRAPH_SCHEMA_SQL);
    this.canonical = this.db.prepare(CANONICAL_IMPACT_WALK_SQL);
    this.cycle = this.db.prepare(CYCLE_SAFE_IMPACT_WALK_SQL);
    this.warmupImpactQueries();
  }

  private warmupImpactQueries(): void {
    const id = "__impact-warmup__";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(
        `INSERT INTO nodes(
          id, kind, title, text, value, status, version, basis, lifecycle, built, landed,
          provenance_quote, code_status, revision_source, amber, dictation_badge,
          freshly_dictated, newly_extracted, age, fields
        ) VALUES (
          :id, 'entity', 'warmup', '', '', 'active', 1, 'explicit', 'discovery', 0, 0,
          '', '', '', 0, 0, 0, 0, 'new', '{}'
        )`,
      ).run({ id });
      this.canonical.all({ start: id, max_depth: 1 });
      this.cycle.all({ start: id, max_depth: 1 });
    } finally {
      this.db.exec("ROLLBACK");
    }
  }

  close(): void {
    this.db.close();
  }

  seedNode(seed: SeedNode): void {
    const version = seed.version ?? 1;
    const fields = JSON.stringify(seed.fields ?? {});
    const text = seed.text ?? seed.title;
    const value = seed.value ?? "";
    this.db.prepare(
      `INSERT INTO nodes(
        id, kind, title, text, value, status, version, basis, lifecycle, built, landed,
        provenance_quote, code_status, revision_source, amber, dictation_badge,
        freshly_dictated, newly_extracted, age, fields
      ) VALUES (
        :id, :kind, :title, :text, :value, :status, :version, :basis, :lifecycle, :built, :landed,
        :quote, :code, :source, :amber, :badge, :fresh, :extracted, :age, :fields
      )`,
    ).run({
      id: seed.id,
      kind: seed.kind,
      title: seed.title,
      text,
      value,
      status: seed.status ?? "active",
      version,
      basis: seed.basis ?? "",
      lifecycle: seed.lifecycle ?? "discovery",
      built: seed.built ? 1 : 0,
      landed: seed.landed ? 1 : 0,
      quote: seed.provenanceQuote ?? "",
      code: seed.codeStatus ?? "",
      source: seed.revisionSource ?? "",
      amber: seed.amberLowConfidence ? 1 : 0,
      badge: seed.dictationBadge ? 1 : 0,
      fresh: seed.freshlyDictated ? 1 : 0,
      extracted: seed.newlyExtracted ? 1 : 0,
      age: seed.age ?? "new",
      fields,
    });
    this.insertVersion(seed.id, version, seed.title, text, value, seed.status ?? "active", fields, seed.revisionSource ?? "");
  }

  seedEdge(edge: SeedEdge): void {
    this.db.prepare(
      "INSERT OR IGNORE INTO edges(src, type, dst, valid_to_rev) VALUES (:src, :type, :dst, NULL)",
    ).run({ src: edge.src, type: edge.type, dst: edge.dst });
  }

  seedTask(task: SeedTask): void {
    this.db.prepare("INSERT INTO task_runtime(task, state, title) VALUES (:id, :state, :title)").run({
      id: task.id,
      state: task.state,
      title: task.title,
    });
    this.seedNode({
      id: task.id,
      kind: "task",
      title: task.title,
      status: "active",
      lifecycle: "building",
      fields: { state: task.state },
    });
  }

  requireBox(id: string): BoxRecord {
    const box = this.getBox(id);
    if (!box) throw new Error(`Unknown canvas box ${id}`);
    return box;
  }

  getBox(id: string): BoxRecord | null {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = :id").get({ id });
    if (!row) return null;
    return this.readBox(row);
  }

  currentEdges(id: string): readonly { readonly src: string; readonly type: string; readonly dst: string }[] {
    return this.db
      .prepare(
        "SELECT src, type, dst FROM edges WHERE (src = :id OR dst = :id) AND valid_to_rev IS NULL ORDER BY src, type, dst",
      )
      .all({ id })
      .map((row) => ({ src: text(row.src), type: text(row.type), dst: text(row.dst) }));
  }

  listTasks(): readonly { readonly id: string; readonly state: string; readonly title: string }[] {
    return this.db
      .prepare("SELECT task, state, title FROM task_runtime ORDER BY task")
      .all()
      .map((row) => ({
        id: text(row.task),
        state: text(row.state),
        title: text(row.title),
      }));
  }

  taskTitle(id: string): string {
    const row = this.db.prepare("SELECT title FROM task_runtime WHERE task = :id").get({ id });
    return row ? text(row.title) : id;
  }

  isActiveTask(id: string): boolean {
    const row = this.db.prepare("SELECT state FROM task_runtime WHERE task = :id").get({ id });
    return row ? ACTIVE_STATES.has(text(row.state)) : false;
  }

  isMergedTask(id: string): boolean {
    const row = this.db.prepare("SELECT state FROM task_runtime WHERE task = :id").get({ id });
    return row ? MERGED_STATES.has(text(row.state)) : false;
  }

  holdCount(): number {
    const row = this.db.prepare("SELECT count(*) AS n FROM task_holds").get();
    return row ? number(row.n) : 0;
  }

  holdsFor(taskId: string): number {
    const row = this.db.prepare("SELECT count(*) AS n FROM task_holds WHERE task = :task").get({ task: taskId });
    return row ? number(row.n) : 0;
  }

  corrections(): readonly MisheardPair[] {
    return this.db
      .prepare("SELECT heard, intended, pair FROM vocabulary_corrections ORDER BY id")
      .all()
      .map((row) => ({ heard: text(row.heard), intended: text(row.intended), pair: text(row.pair) }));
  }

  versionRow(id: string, version: number): VersionRow | null {
    const row = this.db.prepare(
      "SELECT title, text, value, status, fields, revision_source FROM node_versions WHERE id = :id AND version = :version",
    ).get({ id, version });
    if (!row) return null;
    return {
      title: text(row.title),
      text: text(row.text),
      value: text(row.value),
      status: text(row.status),
      fields: text(row.fields),
      revisionSource: text(row.revision_source),
    };
  }

  executeCanonical(startId: string, maxDepth = IMPACT_MAX_DEPTH): ImpactNode[] {
    this.canonicalQueries += 1;
    return this.readWalk(this.canonical.all({ start: startId, max_depth: maxDepth }));
  }

  executeCycleSafe(startId: string, maxDepth = IMPACT_MAX_DEPTH): ImpactNode[] {
    this.cycleSafeQueries += 1;
    return this.readWalk(this.cycle.all({ start: startId, max_depth: maxDepth }));
  }

  replayImpactWalk(startId: string, maxDepth = IMPACT_MAX_DEPTH): void {
    this.canonical.all({ start: startId, max_depth: maxDepth });
    this.cycle.all({ start: startId, max_depth: maxDepth });
  }

  importExternalRevision(id: string, patch: { readonly value: string; readonly text?: string; readonly source: string }): void {
    this.mutate(() => {
      const box = this.requireBox(id);
      const textValue = patch.text ?? replaceValue(box.text, box.value, patch.value);
      const fields = JSON.stringify(box.fields);
      this.writeNode(box, {
        text: textValue,
        value: patch.value,
        status: box.status,
        fields,
        source: patch.source,
      });
    });
  }

  writeWording(
    id: string,
    next: { readonly text: string; readonly value: string; readonly historyLabel: string },
  ): number {
    let version = 0;
    this.mutate(() => {
      const box = this.requireBox(id);
      const fields = { ...box.fields, historyLabel: next.historyLabel };
      version = this.writeNode(box, {
        text: next.text,
        value: next.value,
        status: box.status,
        fields: JSON.stringify(fields),
        source: "box-chat",
      });
    });
    return version;
  }

  writeStatus(id: string, status: string, historyLabel: string): number {
    let version = 0;
    this.mutate(() => {
      const box = this.requireBox(id);
      const fields = { ...box.fields, historyLabel };
      version = this.writeNode(box, {
        text: box.text,
        value: box.value,
        status,
        fields: JSON.stringify(fields),
        source: "box-chat",
      });
    });
    return version;
  }

  addChild(input: {
    readonly childId: string;
    readonly parentId: string;
    readonly kind: string;
    readonly title: string;
    readonly text: string;
  }): void {
    this.mutate(() => {
      const parent = this.requireBox(input.parentId);
      const fields = JSON.stringify({ parentId: parent.id, attachedBy: "box-chat" });
      this.db.prepare(
        `INSERT INTO nodes(
          id, kind, title, text, value, status, version, basis, lifecycle, built, landed,
          provenance_quote, code_status, revision_source, amber, dictation_badge,
          freshly_dictated, newly_extracted, age, fields
        ) VALUES (
          :id, :kind, :title, :text, '', 'proposed', 1, 'explicit', :lifecycle, 0, 0,
          '', '', 'box-chat', 0, 0, 0, 1, 'new', :fields
        )`,
      ).run({
        id: input.childId,
        kind: input.kind,
        title: input.title,
        text: input.text,
        lifecycle: parent.lifecycle,
        fields,
      });
      this.insertVersion(input.childId, 1, input.title, input.text, "", "proposed", fields, "box-chat");
      this.db.prepare(
        "INSERT INTO edges(src, type, dst, valid_to_rev) VALUES (:src, 'belongs_to', :dst, NULL)",
      ).run({ src: input.childId, dst: parent.id });
      this.db.prepare(
        "INSERT INTO edges(src, type, dst, valid_to_rev) VALUES (:src, 'derived_from', :dst, NULL)",
      ).run({ src: input.childId, dst: parent.id });
    });
  }

  placeHolds(taskIds: readonly string[]): void {
    if (taskIds.length === 0) return;
    this.mutate(() => {
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO task_holds(task, reason, source) VALUES (:task, 'revision_in_flight', 'box-chat')",
      );
      for (const taskId of taskIds) insert.run({ task: taskId });
    });
  }

  recordCorrection(pair: MisheardPair): void {
    this.mutate(() => {
      this.db.prepare(
        "INSERT INTO vocabulary_corrections(heard, intended, pair) VALUES (:heard, :intended, :pair)",
      ).run({ heard: pair.heard, intended: pair.intended, pair: pair.pair });
    });
  }

  cleanupFalseDerivations(premiseId: string, falseValue: string): string[] {
    if (!falseValue) return [];
    const rows = this.db.prepare(
      "SELECT src FROM edges WHERE dst = :premise AND type = 'derived_from' AND valid_to_rev IS NULL",
    ).all({ premise: premiseId });
    const cleaned: string[] = [];
    for (const row of rows) {
      const id = text(row.src);
      const box = this.getBox(id);
      if (!box) continue;
      if (!box.text.includes(falseValue) && !box.value.includes(falseValue)) continue;
      this.writeStatus(id, "reopened", "false premise cleaned");
      cleaned.push(id);
    }
    return cleaned;
  }

  restoreVersion(id: string, version: number): number {
    const prior = this.versionRow(id, version);
    if (!prior) throw new Error(`Missing version ${version} for ${id}`);
    let written = 0;
    this.mutate(() => {
      const box = this.requireBox(id);
      written = this.writeNode(box, {
        text: prior.text,
        value: prior.value,
        status: prior.status,
        fields: prior.fields,
        source: "undo",
      });
    });
    return written;
  }

  revertChild(childId: string): void {
    this.mutate(() => {
      const box = this.requireBox(childId);
      this.writeNode(box, {
        text: box.text,
        value: box.value,
        status: "reverted",
        fields: JSON.stringify(box.fields),
        source: "undo",
      });
      this.db.prepare(
        "UPDATE edges SET valid_to_rev = :rev WHERE src = :src AND valid_to_rev IS NULL",
      ).run({ src: childId, rev: box.version + 1 });
    });
  }

  private writeNode(
    box: BoxRecord,
    next: { readonly text: string; readonly value: string; readonly status: string; readonly fields: string; readonly source: string },
  ): number {
    const version = box.version + 1;
    this.db.prepare(
      `UPDATE nodes
          SET text = :text, value = :value, status = :status, version = :version,
              fields = :fields, revision_source = :source
        WHERE id = :id`,
    ).run({
      text: next.text,
      value: next.value,
      status: next.status,
      version,
      fields: next.fields,
      source: next.source,
      id: box.id,
    });
    this.insertVersion(box.id, version, box.title, next.text, next.value, next.status, next.fields, next.source);
    return version;
  }

  private insertVersion(
    id: string,
    version: number,
    title: string,
    textValue: string,
    value: string,
    status: string,
    fields: string,
    source: string,
  ): void {
    this.db.prepare(
      `INSERT INTO node_versions(id, version, title, text, value, status, fields, revision_source)
       VALUES (:id, :version, :title, :text, :value, :status, :fields, :source)`,
    ).run({
      id,
      version,
      title,
      text: textValue,
      value,
      status,
      fields,
      source,
    });
  }

  private mutate(fn: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
      this.mutationCount += 1;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private readWalk(rows: readonly Record<string, SQLOutputValue>[]): ImpactNode[] {
    const nodes: ImpactNode[] = [];
    for (const row of rows) {
      const id = text(row.id);
      if (!id) continue;
      nodes.push({ id, depth: number(row.depth) });
    }
    nodes.sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id));
    return nodes;
  }

  private readBox(row: Record<string, SQLOutputValue>): BoxRecord {
    return {
      id: text(row.id),
      kind: text(row.kind),
      title: text(row.title),
      text: text(row.text),
      value: text(row.value),
      status: text(row.status),
      version: number(row.version),
      basis: text(row.basis),
      lifecycle: stage(text(row.lifecycle)),
      built: number(row.built) === 1,
      landed: number(row.landed) === 1,
      provenanceQuote: text(row.provenance_quote),
      codeStatus: text(row.code_status),
      revisionSource: text(row.revision_source),
      amberLowConfidence: number(row.amber) === 1,
      dictationBadge: number(row.dictation_badge) === 1,
      freshlyDictated: number(row.freshly_dictated) === 1,
      newlyExtracted: number(row.newly_extracted) === 1,
      age: text(row.age) === "older" ? "older" : "new",
      fields: parseFields(text(row.fields)),
    };
  }
}

function replaceValue(text: string, previous: string, next: string): string {
  if (previous && text.includes(previous)) return text.replaceAll(previous, next);
  return text;
}

function parseFields(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function stage(value: string): ProjectStage {
  if (value === "spec" || value === "plan" || value === "building" || value === "merged" || value === "done") {
    return value;
  }
  return "discovery";
}

function text(value: SQLOutputValue | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function number(value: SQLOutputValue | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}
