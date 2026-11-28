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
const INVALIDATES = new Set([
  "implements",
  "verifies",
  "consumes_contract",
  "produces_contract",
  "obeys",
  "handles_edge_case",
  "derived_from",
  "depends_on",
  "waives",
]);
const CYCLE_EXTRA = new Set(["belongs_to", "consumes"]);
const WALK_LIMIT = 5001;

interface VersionRow {
  readonly title: string;
  readonly text: string;
  readonly value: string;
  readonly status: string;
  readonly fields: string;
  readonly revisionSource: string;
}

interface NodeRow {
  id: string;
  kind: string;
  title: string;
  text: string;
  value: string;
  status: string;
  version: number;
  basis: string;
  lifecycle: string;
  built: boolean;
  landed: boolean;
  provenanceQuote: string;
  codeStatus: string;
  revisionSource: string;
  amber: boolean;
  dictationBadge: boolean;
  freshlyDictated: boolean;
  newlyExtracted: boolean;
  age: "new" | "older";
  fields: string;
}

interface EdgeRow {
  src: string;
  type: string;
  dst: string;
  validToRev: number | null;
}

interface TaskRow {
  id: string;
  state: string;
  title: string;
}

/**
 * In-renderer box graph. Impact walks follow the canonical `impact_walk`
 * statement in `schema/queries.sql`. Persistence and the SQL itself run in
 * `apps/daemon`.
 */
export class IntentGraph {
  mutationCount = 0;
  canonicalQueries = 0;
  cycleSafeQueries = 0;
  private readonly nodes = new Map<string, NodeRow>();
  private readonly versionIndex = new Map<string, VersionRow>();
  private readonly edges: EdgeRow[] = [];
  private readonly tasks = new Map<string, TaskRow>();
  private readonly holds = new Set<string>();
  private readonly correctionRows: MisheardPair[] = [];
  private closed = false;

  close(): void {
    this.closed = true;
  }

  seedNode(seed: SeedNode): void {
    this.assertOpen();
    const version = seed.version ?? 1;
    const fields = JSON.stringify(seed.fields ?? {});
    const text = seed.text ?? seed.title;
    const value = seed.value ?? "";
    const row: NodeRow = {
      id: seed.id,
      kind: seed.kind,
      title: seed.title,
      text,
      value,
      status: seed.status ?? "active",
      version,
      basis: seed.basis ?? "",
      lifecycle: seed.lifecycle ?? "discovery",
      built: seed.built === true,
      landed: seed.landed === true,
      provenanceQuote: seed.provenanceQuote ?? "",
      codeStatus: seed.codeStatus ?? "",
      revisionSource: seed.revisionSource ?? "",
      amber: seed.amberLowConfidence === true,
      dictationBadge: seed.dictationBadge === true,
      freshlyDictated: seed.freshlyDictated === true,
      newlyExtracted: seed.newlyExtracted === true,
      age: seed.age === "older" ? "older" : "new",
      fields,
    };
    this.nodes.set(seed.id, row);
    this.insertVersion(seed.id, version, seed.title, text, value, row.status, fields, row.revisionSource);
  }

  seedEdge(edge: SeedEdge): void {
    this.assertOpen();
    const exists = this.edges.some(
      (row) => row.src === edge.src && row.type === edge.type && row.dst === edge.dst && row.validToRev === null,
    );
    if (exists) return;
    this.edges.push({ src: edge.src, type: edge.type, dst: edge.dst, validToRev: null });
  }

  seedTask(task: SeedTask): void {
    this.assertOpen();
    this.tasks.set(task.id, { id: task.id, state: task.state, title: task.title });
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
    const row = this.nodes.get(id);
    if (!row) return null;
    return readBox(row);
  }

  currentEdges(id: string): readonly { readonly src: string; readonly type: string; readonly dst: string }[] {
    return this.edges
      .filter((edge) => edge.validToRev === null && (edge.src === id || edge.dst === id))
      .map((edge) => ({ src: edge.src, type: edge.type, dst: edge.dst }))
      .sort((left, right) => left.src.localeCompare(right.src) || left.type.localeCompare(right.type) || left.dst.localeCompare(right.dst));
  }

  listTasks(): readonly { readonly id: string; readonly state: string; readonly title: string }[] {
    return [...this.tasks.values()]
      .map((task) => ({ id: task.id, state: task.state, title: task.title }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  taskTitle(id: string): string {
    return this.tasks.get(id)?.title ?? id;
  }

  isActiveTask(id: string): boolean {
    const state = this.tasks.get(id)?.state;
    return state ? ACTIVE_STATES.has(state) : false;
  }

  isMergedTask(id: string): boolean {
    const state = this.tasks.get(id)?.state;
    return state ? MERGED_STATES.has(state) : false;
  }

  holdCount(): number {
    return this.holds.size;
  }

  holdsFor(taskId: string): number {
    let count = 0;
    for (const key of this.holds) {
      if (key.startsWith(`${taskId}\u0000`)) count += 1;
    }
    return count;
  }

  corrections(): readonly MisheardPair[] {
    return this.correctionRows.map((pair) => ({ ...pair }));
  }

  versionRow(id: string, version: number): VersionRow | null {
    return this.versionIndex.get(versionKey(id, version)) ?? null;
  }

  executeCanonical(startId: string, maxDepth = IMPACT_MAX_DEPTH): ImpactNode[] {
    this.canonicalQueries += 1;
    return this.walk(startId, maxDepth, false);
  }

  executeCycleSafe(startId: string, maxDepth = IMPACT_MAX_DEPTH): ImpactNode[] {
    this.cycleSafeQueries += 1;
    return this.walk(startId, maxDepth, true);
  }

  replayImpactWalk(startId: string, maxDepth = IMPACT_MAX_DEPTH): void {
    this.walk(startId, maxDepth, false);
    this.walk(startId, maxDepth, true);
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
      const row: NodeRow = {
        id: input.childId,
        kind: input.kind,
        title: input.title,
        text: input.text,
        value: "",
        status: "proposed",
        version: 1,
        basis: "explicit",
        lifecycle: parent.lifecycle,
        built: false,
        landed: false,
        provenanceQuote: "",
        codeStatus: "",
        revisionSource: "box-chat",
        amber: false,
        dictationBadge: false,
        freshlyDictated: false,
        newlyExtracted: true,
        age: "new",
        fields,
      };
      this.nodes.set(input.childId, row);
      this.insertVersion(input.childId, 1, input.title, input.text, "", "proposed", fields, "box-chat");
      this.edges.push({ src: input.childId, type: "belongs_to", dst: parent.id, validToRev: null });
      this.edges.push({ src: input.childId, type: "derived_from", dst: parent.id, validToRev: null });
    });
  }

  placeHolds(taskIds: readonly string[]): void {
    if (taskIds.length === 0) return;
    this.mutate(() => {
      for (const taskId of taskIds) this.holds.add(`${taskId}\u0000revision_in_flight\u0000box-chat`);
    });
  }

  recordCorrection(pair: MisheardPair): void {
    this.mutate(() => {
      this.correctionRows.push({ heard: pair.heard, intended: pair.intended, pair: pair.pair });
    });
  }

  cleanupFalseDerivations(premiseId: string, falseValue: string): string[] {
    if (!falseValue) return [];
    const sources = this.edges
      .filter((edge) => edge.dst === premiseId && edge.type === "derived_from" && edge.validToRev === null)
      .map((edge) => edge.src);
    const cleaned: string[] = [];
    for (const id of sources) {
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
      const nextVersion = box.version + 1;
      this.writeNode(box, {
        text: box.text,
        value: box.value,
        status: "reverted",
        fields: JSON.stringify(box.fields),
        source: "undo",
      });
      for (const edge of this.edges) {
        if (edge.src === childId && edge.validToRev === null) edge.validToRev = nextVersion;
      }
    });
  }

  private writeNode(
    box: BoxRecord,
    next: { readonly text: string; readonly value: string; readonly status: string; readonly fields: string; readonly source: string },
  ): number {
    const current = this.nodes.get(box.id);
    if (!current) throw new Error(`Unknown canvas box ${box.id}`);
    const version = box.version + 1;
    current.text = next.text;
    current.value = next.value;
    current.status = next.status;
    current.version = version;
    current.fields = next.fields;
    current.revisionSource = next.source;
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
    const row: VersionRow = {
      title,
      text: textValue,
      value,
      status,
      fields,
      revisionSource: source,
    };
    this.versionIndex.set(versionKey(id, version), row);
  }

  private mutate(fn: () => void): void {
    this.assertOpen();
    fn();
    this.mutationCount += 1;
  }

  private walk(startId: string, maxDepth: number, cycleSafe: boolean): ImpactNode[] {
    const best = new Map<string, number>();
    const queue: { id: string; depth: number; seen: string }[] = [
      { id: startId, depth: 0, seen: `\u0001${startId}\u0001` },
    ];
    let produced = 0;
    while (queue.length > 0 && produced < WALK_LIMIT) {
      const current = queue.shift();
      if (!current) break;
      const previous = best.get(current.id);
      if (previous === undefined || current.depth < previous) best.set(current.id, current.depth);
      produced += 1;
      if (current.depth >= maxDepth || produced >= WALK_LIMIT) continue;
      for (const edge of this.edges) {
        if (edge.dst !== current.id || edge.validToRev !== null) continue;
        if (!edgeAllowed(edge.type, cycleSafe)) continue;
        const marker = `\u0001${edge.src}\u0001`;
        if (cycleSafe && current.seen.includes(marker)) continue;
        queue.push({
          id: edge.src,
          depth: current.depth + 1,
          seen: `${current.seen}${edge.src}\u0001`,
        });
      }
    }
    return [...best.entries()]
      .map(([id, depth]) => ({ id, depth }))
      .sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id));
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Intent graph is closed");
  }
}

function edgeAllowed(type: string, cycleSafe: boolean): boolean {
  if (INVALIDATES.has(type)) return true;
  return cycleSafe && CYCLE_EXTRA.has(type);
}

function replaceValue(text: string, previous: string, next: string): string {
  if (previous && text.includes(previous)) return text.replaceAll(previous, next);
  return text;
}

function readBox(row: NodeRow): BoxRecord {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    text: row.text,
    value: row.value,
    status: row.status,
    version: row.version,
    basis: row.basis,
    lifecycle: stage(row.lifecycle),
    built: row.built,
    landed: row.landed,
    provenanceQuote: row.provenanceQuote,
    codeStatus: row.codeStatus,
    revisionSource: row.revisionSource,
    amberLowConfidence: row.amber,
    dictationBadge: row.dictationBadge,
    freshlyDictated: row.freshlyDictated,
    newlyExtracted: row.newlyExtracted,
    age: row.age,
    fields: parseFields(row.fields),
  };
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

function versionKey(id: string, version: number): string {
  return `${id}\u0000${version}`;
}
