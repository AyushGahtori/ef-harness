import { verifyMermaidSyntax } from "./mermaid-syntax.js";
import { PHASE0_FOUNDATION, type ArchitectureViolation, violation } from "./types.js";
import {
  type ArchitectureStore,
  type GraphEdge,
  type GraphNode,
  readString,
  readStringList,
} from "./state-db.js";

export interface HoistedRule {
  readonly concern: string;
  readonly nodeId: string;
}

export interface GateReport {
  readonly violations: readonly ArchitectureViolation[];
  readonly blocking: readonly ArchitectureViolation[];
  readonly hoisted: readonly HoistedRule[];
}

interface HoistGroup {
  readonly concern: "auth" | "tenant" | "error" | "utc_money";
  readonly nodeId: string;
  readonly kind: "contract" | "rule";
  readonly title: string;
  readonly text: string;
  readonly sources: readonly GraphNode[];
}

const REQUIREMENT_KINDS = new Set(["spec_item", "edge_case", "journey", "rule"]);
const CASE_FOLD_KINDS = new Set([
  "http_route",
  "page_route",
  "db_table",
  "db_column",
  "db_index",
  "db_constraint",
  "env_var",
]);

const HOIST_TARGETS = {
  auth: { nodeId: "contract:auth-session", kind: "contract", title: "Auth session" },
  tenant: { nodeId: "rule:tenant-scope", kind: "rule", title: "Tenant scope" },
  error: { nodeId: "contract:error-envelope", kind: "contract", title: "Error envelope" },
  utc_money: { nodeId: "rule:utc-money", kind: "rule", title: "UTC and money" },
} as const;

export class DeterministicArchConsistencyGate {
  async run(store: ArchitectureStore): Promise<GateReport> {
    const nodes = store.listNodes();
    const active = nodes.filter((node) => node.status === "active");
    const edges = store.listEdges();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const violations: ArchitectureViolation[] = [
      ...danglingViolations(store, byId, edges),
      ...shadowViolations(store, active),
      ...unhoistedViolations(active),
      ...orphanViolations(active, edges, byId),
      ...cycleViolations(active, edges),
      ...(await mermaidViolations(active)),
    ];
    const groups = hoistGroups(active);
    const hoisted = groups.length > 0 ? applyHoist(store, groups) : [];
    const blocking =
      hoisted.length === 0 ? violations : violations.filter((item) => item.code !== "unhoisted_duplicated_rule");
    return { violations, blocking, hoisted };
  }
}

function danglingViolations(
  store: ArchitectureStore,
  byId: ReadonlyMap<string, GraphNode>,
  edges: readonly GraphEdge[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const seen = new Set<string>();
  const flag = (source: string, target: string, why: string): void => {
    const key = `${source}\u0000${target}\u0000${why}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push(
      violation("dangling_ref", `${why} ${source} -> ${target} does not resolve to an active node.`, [source, target]),
    );
  };
  for (const edge of edges) {
    const src = byId.get(edge.src);
    const dst = byId.get(edge.dst);
    if (!src || src.status !== "active") flag(edge.src, edge.dst, `edge ${edge.type} source`);
    if (!dst || dst.status !== "active") flag(edge.src, edge.dst, `edge ${edge.type} target`);
  }
  const embedded = new Set(store.relationsInFields());
  for (const id of embedded) {
    const node = byId.get(id);
    if (!node || node.status !== "active") flag(id, id, "relations_in_fields node");
  }
  for (const node of byId.values()) {
    if (node.status !== "active") continue;
    const why = embedded.has(node.id) ? "relations_in_fields reference" : "node reference";
    for (const target of referencedIds(node.fields)) {
      const resolved = byId.get(target);
      if (!resolved || resolved.status !== "active") flag(node.id, target, why);
    }
  }
  return violations;
}

function referencedIds(fields: Readonly<Record<string, unknown>>): string[] {
  const ids = [
    ...readStringList(fields.depends_on),
    ...readStringList(fields.implements),
    ...readStringList(fields.verifies),
    ...readStringList(fields.consumes),
    ...readStringList(fields.justified_by),
    ...readStringList(fields.unresolved_refs),
  ];
  const relations = fields.relations;
  if (Array.isArray(relations)) {
    for (const relation of relations) {
      if (!relation || typeof relation !== "object") continue;
      const target = (relation as { target?: unknown }).target;
      if (typeof target === "string") ids.push(target);
    }
  }
  return ids;
}

function shadowViolations(store: ArchitectureStore, active: readonly GraphNode[]): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const grouped = new Map<string, { kind: string; value: string; owner: string }[]>();
  for (const name of store.listNames()) {
    const folded = foldName(name.kind, name.value);
    const key = `${name.kind}\u0000${folded}`;
    const list = grouped.get(key) ?? [];
    list.push({ kind: name.kind, value: name.value, owner: name.ownerNode });
    grouped.set(key, list);
  }
  for (const [key, rows] of grouped) {
    if (rows.length < 2) continue;
    const values = [...new Set(rows.map((row) => row.value))];
    const owners = [...new Set(rows.map((row) => row.owner))];
    if (values.length < 2 && owners.length < 2) continue;
    violations.push(
      violation(
        "shadowed_name",
        `Shadowed canonical name ${key.split("\u0000")[0]}: ${values.join(" vs ")}.`,
        owners,
      ),
    );
  }
  const modules = new Map<string, string[]>();
  for (const node of active) {
    const role = readString(node.fields, "arch_role");
    if (role !== "module" && role !== "component" && role !== "entity") continue;
    const canonical = readString(node.fields, "canonical_name");
    if (!canonical) continue;
    const folded = canonical.trim().toLowerCase();
    const list = modules.get(folded) ?? [];
    list.push(node.id);
    modules.set(folded, list);
  }
  for (const [name, ids] of modules) {
    if (ids.length < 2) continue;
    violations.push(violation("shadowed_name", `Shadowed module or entity name ${name}.`, ids));
  }
  return violations;
}

function unhoistedViolations(active: readonly GraphNode[]): ArchitectureViolation[] {
  return hoistGroups(active).map((group) =>
    violation(
      "unhoisted_duplicated_rule",
      `Unhoisted ${group.concern} fields across ${group.sources.map((node) => readString(node.fields, "feature") ?? node.id).join(" and ")}. Hoisted into ${group.nodeId}.`,
      group.sources.map((node) => node.id),
    ),
  );
}

function hoistGroups(active: readonly GraphNode[]): HoistGroup[] {
  const buckets = new Map<HoistGroup["concern"], GraphNode[]>();
  for (const node of active) {
    if (!isFeatureLocal(node)) continue;
    const concern = concernOf(node);
    if (!concern) continue;
    const list = buckets.get(concern) ?? [];
    list.push(node);
    buckets.set(concern, list);
  }
  const groups: HoistGroup[] = [];
  for (const [concern, sources] of buckets) {
    const features = new Set(sources.map((node) => readString(node.fields, "feature")).filter((id): id is string => !!id));
    if (features.size < 2) continue;
    const texts = new Set(sources.map((node) => normalizedText(node)));
    if (texts.size < 2) continue;
    const target = HOIST_TARGETS[concern];
    const text = [...texts].sort()[0] ?? "";
    groups.push({ concern, nodeId: target.nodeId, kind: target.kind, title: target.title, text, sources });
  }
  return groups;
}

function applyHoist(store: ArchitectureStore, groups: readonly HoistGroup[]): HoistedRule[] {
  const nodes = [];
  const edges = [];
  const hoisted: HoistedRule[] = [];
  for (const group of groups) {
    nodes.push({
      id: group.nodeId,
      kind: group.kind,
      title: group.title,
      text: group.text,
      fields: {
        feature: PHASE0_FOUNDATION,
        basis: "derived",
        owner: PHASE0_FOUNDATION,
        system_rule: group.kind === "rule",
        schema_text: group.text,
        hoisted_from: group.sources.map((node) => node.id),
      },
      ownerRole: PHASE0_FOUNDATION,
    });
    for (const source of group.sources) {
      nodes.push({
        id: source.id,
        kind: source.kind,
        title: source.title,
        text: group.text,
        fields: { ...source.fields, hoisted: true, schema_text: group.text },
        ownerRole: source.fields.owner === undefined ? null : String(source.fields.owner),
      });
      edges.push({ src: source.id, type: "obeys", dst: group.nodeId });
    }
    hoisted.push({ concern: group.concern, nodeId: group.nodeId });
  }
  store.commitChangeSet({
    author: "system-architect@1",
    summary: "hoist duplicated cross-cutting rules",
    nodes,
    edges,
  });
  return hoisted;
}

function orphanViolations(
  active: readonly GraphNode[],
  edges: readonly GraphEdge[],
  byId: ReadonlyMap<string, GraphNode>,
): ArchitectureViolation[] {
  const orphans = active
    .filter((node) => isRequirement(node) && !isCovered(node.id, edges, byId))
    .map((node) => node.id)
    .sort();
  if (orphans.length === 0) return [];
  const listed = orphans.map((id) => `'${id}'`).join(", ");
  return [violation("orphan_requirements", `orphan_requirements: [${listed}]`, orphans)];
}

function cycleViolations(active: readonly GraphNode[], edges: readonly GraphEdge[]): ArchitectureViolation[] {
  const cycle = findFeatureCycle(active, edges);
  if (cycle.length === 0) return [];
  const trace = cycle.join(" -> ");
  return [violation("feature_cycle", `Feature dependency cycle: ${trace}`, cycle, cycle)];
}

function findFeatureCycle(active: readonly GraphNode[], edges: readonly GraphEdge[]): string[] {
  const features = new Set(active.filter((node) => node.kind === "feature").map((node) => node.id));
  const adjacent = new Map<string, string[]>();
  for (const id of features) adjacent.set(id, []);
  for (const edge of edges) {
    if (edge.type !== "depends_on") continue;
    if (!features.has(edge.src) || !features.has(edge.dst)) continue;
    adjacent.get(edge.src)?.push(edge.dst);
  }
  for (const targets of adjacent.values()) targets.sort();
  const state = new Map<string, "in" | "done">();
  const stack: string[] = [];
  let cycle: string[] = [];
  const visit = (id: string): void => {
    if (cycle.length > 0) return;
    state.set(id, "in");
    stack.push(id);
    for (const next of adjacent.get(id) ?? []) {
      if (cycle.length > 0) return;
      const mark = state.get(next);
      if (mark === "in") {
        const start = stack.indexOf(next);
        cycle = [...stack.slice(start), next];
        return;
      }
      if (mark !== "done") visit(next);
    }
    stack.pop();
    state.set(id, "done");
  };
  for (const id of [...features].sort()) {
    if (!state.has(id)) visit(id);
  }
  return cycle;
}

async function mermaidViolations(active: readonly GraphNode[]): Promise<ArchitectureViolation[]> {
  const violations: ArchitectureViolation[] = [];
  for (const node of active) {
    if (readString(node.fields, "arch_role") !== "diagram" && readString(node.fields, "diagram_kind") === undefined) {
      continue;
    }
    const parsed = await verifyMermaidSyntax(node.text);
    if (parsed.ok) continue;
    violations.push(violation("invalid_mermaid", `${node.id} failed Mermaid parse: ${parsed.message}`, [node.id]));
  }
  return violations;
}

function isRequirement(node: GraphNode): boolean {
  if (!REQUIREMENT_KINDS.has(node.kind)) return false;
  if (node.kind === "rule" && node.fields.system_rule === true) return false;
  return true;
}

function isCovered(id: string, edges: readonly GraphEdge[], byId: ReadonlyMap<string, GraphNode>): boolean {
  for (const edge of edges) {
    if (edge.type === "implements" && edge.dst === id) {
      const src = byId.get(edge.src);
      if (src && src.status === "active" && (src.kind === "feature" || src.fields.system_rule === true)) return true;
    }
    if (edge.type === "obeys" && edge.src === id) {
      const dst = byId.get(edge.dst);
      if (dst && dst.status === "active" && dst.fields.system_rule === true) return true;
    }
  }
  return false;
}

function isFeatureLocal(node: GraphNode): boolean {
  const feature = readString(node.fields, "feature");
  if (!feature || feature === PHASE0_FOUNDATION) return false;
  if (node.fields.system_rule === true || node.fields.hoisted === true) return false;
  return node.kind === "contract" || node.kind === "rule" || readString(node.fields, "arch_role") === "convention";
}

function concernOf(node: GraphNode): HoistGroup["concern"] | null {
  const blob = `${node.title}\n${node.text}\n${readString(node.fields, "schema_text") ?? ""}`.toLowerCase();
  if (/\bjwt\b|\bbearer\b|authorization header|auth middleware/.test(blob)) return "auth";
  if (/tenant scop/.test(blob)) return "tenant";
  if (/error envelope|error format/.test(blob)) return "error";
  if (/\butc\b|minor unit|money format/.test(blob)) return "utc_money";
  return null;
}

function normalizedText(node: GraphNode): string {
  return `${node.text}\n${readString(node.fields, "schema_text") ?? ""}`.replace(/\s+/g, " ").trim().toLowerCase();
}

function foldName(kind: string, value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return CASE_FOLD_KINDS.has(kind) ? trimmed.toLowerCase() : trimmed;
}
