import { isRecord } from "./canonical.js";
import { issue } from "./issues.js";
import { mermaidIssues } from "./mermaid.js";
import { seamById, type SeamSharedKind } from "./seams.js";
import { isColumnSpec, SkeletonLockEnforcer } from "./skeleton-lock.js";
import {
  LOCAL_PORTS,
  type ArchIssue,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  type NameRegistration,
  type SchemaDelta,
  type SkeletonSnapshot,
} from "./types.js";

export class DeterministicArchConsistencyGate {
  static readonly source = LOCAL_PORTS.deterministicArchConsistencyGate;

  private readonly locks = new SkeletonLockEnforcer();

  check(input: {
    nodes: readonly GraphNode[];
    edges: readonly GraphEdge[];
    skeleton: SkeletonSnapshot;
    existingNames: readonly NameRegistration[];
  }): { ok: boolean; issues: ArchIssue[] } {
    const issues: ArchIssue[] = [];
    const ids = new Set(input.nodes.map((node) => node.id));
    this.dangling(input.nodes, input.edges, ids, issues);
    this.names(input.nodes, input.existingNames, issues);
    this.rules(input.nodes, issues);
    this.coverage(input.nodes, input.edges, issues);
    this.cycles(input.edges, issues);
    this.diagrams(input.nodes, issues);
    this.seams(input.nodes, issues);
    this.paths(input.nodes, issues);
    this.skeleton(input.nodes, input.skeleton, issues);
    return { ok: issues.length === 0, issues };
  }

  private dangling(
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[],
    ids: ReadonlySet<string>,
    issues: ArchIssue[],
  ): void {
    for (const edge of edges) {
      if (!ids.has(edge.src) || !ids.has(edge.dst)) {
        issues.push(
          issue("dangling_ref", `Edge ${edge.type} ${edge.src} -> ${edge.dst} is dangling.`, {
            nodeId: ids.has(edge.src) ? edge.dst : edge.src,
          }),
        );
      }
    }
    for (const node of nodes) {
      const links = node.fields.linkedNodeIds;
      if (!Array.isArray(links)) continue;
      for (const link of links) {
        if (typeof link === "string" && !ids.has(link)) {
          issues.push(issue("dangling_ref", `Node ${node.id} links to missing ${link}.`, { nodeId: link }));
        }
      }
    }
  }

  private names(
    nodes: readonly GraphNode[],
    existingNames: readonly NameRegistration[],
    issues: ArchIssue[],
  ): void {
    const seen = new Map<string, string>();
    const register = (kind: string, name: string, ownerId: string): void => {
      const key = `${kind}\0${name}`;
      const prior = seen.get(key);
      if (prior === undefined) {
        seen.set(key, ownerId);
        return;
      }
      if (prior !== ownerId) {
        issues.push(
          issue("shadowed_name", `${kind} ${name} is owned by both ${prior} and ${ownerId}.`),
        );
      }
    };
    for (const name of existingNames) register(name.kind, name.name, name.ownerId);
    for (const node of nodes) {
      const owner = stringField(node.fields, "ownerId") ?? node.id;
      const raw = node.fields.registeredNames;
      if (!Array.isArray(raw)) continue;
      for (const item of raw) {
        if (!isRecord(item) || typeof item.kind !== "string" || typeof item.name !== "string") continue;
        register(item.kind, item.name, owner);
      }
    }
  }

  private rules(nodes: readonly GraphNode[], issues: ArchIssue[]): void {
    for (const node of nodes) {
      if (node.kind !== "rule") continue;
      const featureIds = stringList(node.fields.featureIds);
      const unique = [...new Set(featureIds)];
      if (unique.length >= 2 && node.fields.hoisted !== true) {
        issues.push(
          issue(
            "unhoisted_duplicated_rule",
            `Rule ${node.id} is duplicated across ${unique.join(", ")} and was not hoisted.`,
            { nodeId: node.id },
          ),
        );
      }
    }
  }

  private coverage(nodes: readonly GraphNode[], edges: readonly GraphEdge[], issues: ArchIssue[]): void {
    for (const node of nodes) {
      if (node.fields.catalogRequirement === true && !hasIncoming(edges, node.id, "implements")) {
        issues.push(
          issue("orphan_requirement", `Requirement ${node.id} is not allocated to a feature.`, {
            nodeId: node.id,
          }),
        );
      }
      if (node.kind === "spec_item" && node.fields.catalogRequirement !== true && !hasIncoming(edges, node.id, "implements")) {
        issues.push(
          issue("unhandled_spec_item", `Spec item ${node.id} is not handled by a feature node.`, {
            nodeId: node.id,
          }),
        );
      }
      if (node.kind === "edge_case" && !hasIncoming(edges, node.id, "handles_edge_case")) {
        issues.push(
          issue("unhandled_edge_case", `Edge case ${node.id} has no handling node.`, { nodeId: node.id }),
        );
      }
    }
  }

  private cycles(edges: readonly GraphEdge[], issues: ArchIssue[]): void {
    const adjacent = new Map<string, string[]>();
    for (const edge of edges) {
      if (edge.type !== "depends_on") continue;
      const list = adjacent.get(edge.src) ?? [];
      list.push(edge.dst);
      adjacent.set(edge.src, list);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const found = new Set<string>();
    const dfs = (node: string, stack: string[]): void => {
      if (visiting.has(node)) {
        const start = stack.indexOf(node);
        const cycle = [...stack.slice(Math.max(0, start)), node];
        found.add(cycle.join(" -> "));
        return;
      }
      if (visited.has(node)) return;
      visiting.add(node);
      stack.push(node);
      for (const next of adjacent.get(node) ?? []) dfs(next, stack);
      stack.pop();
      visiting.delete(node);
      visited.add(node);
    };
    for (const node of adjacent.keys()) dfs(node, []);
    for (const cycle of found) {
      issues.push(issue("feature_dependency_cycle", `Feature dependency cycle: ${cycle}.`));
    }
  }

  private diagrams(nodes: readonly GraphNode[], issues: ArchIssue[]): void {
    for (const node of nodes) {
      const source = node.fields.mermaid;
      const kind = node.fields.mermaidKind;
      if (typeof source !== "string") continue;
      if (kind !== "sequence" && kind !== "state") {
        issues.push(issue("invalid_mermaid", `Node ${node.id} has a diagram without a sequence or state kind.`, { nodeId: node.id }));
        continue;
      }
      for (const problem of mermaidIssues(source, kind)) {
        issues.push(issue("invalid_mermaid", `${node.id}: ${problem}`, { nodeId: node.id }));
      }
    }
  }

  private seams(nodes: readonly GraphNode[], issues: ArchIssue[]): void {
    for (const node of nodes) {
      if (node.fields.role !== "seam_binding") continue;
      const templateId = stringField(node.fields, "templateId") ?? "";
      const template = seamById(templateId);
      if (!template) {
        issues.push(
          issue("seam_reference", `Seam ${templateId || "(missing)"} is not one of S-01..S-10.`, {
            nodeId: node.id,
          }),
        );
        continue;
      }
      const shared = stringField(node.fields, "sharedKind");
      if (shared && !template.shared.includes(shared as SeamSharedKind)) {
        issues.push(
          issue(
            "seam_reference",
            `Seam ${template.id} does not share ${shared}. Expected ${template.shared.join(", ")}.`,
            { nodeId: node.id },
          ),
        );
      }
    }
  }

  private paths(nodes: readonly GraphNode[], issues: ArchIssue[]): void {
    const grouped = new Map<string, { path: string; featureIds: string[] }>();
    for (const node of nodes) {
      if (node.fields.role !== "file_boundary") continue;
      const writePath = stringField(node.fields, "writePath");
      const featureId = stringField(node.fields, "featureId");
      if (!writePath || !featureId) continue;
      const key = writePath.replaceAll("\\", "/").toLowerCase();
      const current = grouped.get(key);
      if (!current) grouped.set(key, { path: writePath, featureIds: [featureId] });
      else if (!current.featureIds.includes(featureId)) current.featureIds.push(featureId);
    }
    for (const overlap of grouped.values()) {
      if (overlap.featureIds.length < 2) continue;
      const ids = [...overlap.featureIds].sort();
      issues.push(
        issue(
          "write_path_overlap",
          `Features ${ids.join(" and ")} both write ${overlap.path}. Hoist the file to phase0-foundation (hoist-shared) or split into disjoint module paths (split-modules).`,
        ),
      );
    }
  }

  private skeleton(nodes: readonly GraphNode[], skeleton: SkeletonSnapshot, issues: ArchIssue[]): void {
    const deltas: SchemaDelta[] = [];
    for (const node of nodes) {
      if (node.fields.role !== "schema_delta") continue;
      const delta = parseSchemaDelta(node.fields.delta);
      if (!delta) {
        issues.push(issue("invalid_schema_delta", `Schema node ${node.id} has no readable delta.`, { nodeId: node.id }));
        continue;
      }
      deltas.push(delta);
    }
    issues.push(...this.locks.check(deltas, skeleton).violations);
  }
}

function hasIncoming(edges: readonly GraphEdge[], dst: string, type: EdgeType): boolean {
  return edges.some((edge) => edge.dst === dst && edge.type === type);
}

function stringField(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function parseSchemaDelta(value: unknown): SchemaDelta | null {
  if (!isRecord(value) || typeof value.op !== "string") return null;
  if (value.op === "add_table" && typeof value.table === "string" && Array.isArray(value.columns)) {
    if (!value.columns.every(isColumnSpec)) return null;
    return { op: "add_table", table: value.table, columns: value.columns };
  }
  if (value.op === "add_column" && typeof value.table === "string" && isColumnSpec(value.column)) {
    return { op: "add_column", table: value.table, column: value.column };
  }
  if (value.op === "drop_column" && typeof value.table === "string" && typeof value.column === "string") {
    return { op: "drop_column", table: value.table, column: value.column };
  }
  if (
    value.op === "rename_column" &&
    typeof value.table === "string" &&
    typeof value.from === "string" &&
    typeof value.to === "string"
  ) {
    return { op: "rename_column", table: value.table, from: value.from, to: value.to };
  }
  if (
    value.op === "change_type" &&
    typeof value.table === "string" &&
    typeof value.column === "string" &&
    typeof value.toType === "string"
  ) {
    return { op: "change_type", table: value.table, column: value.column, toType: value.toType };
  }
  if (value.op === "drop_table" && typeof value.table === "string") {
    return { op: "drop_table", table: value.table };
  }
  return null;
}
