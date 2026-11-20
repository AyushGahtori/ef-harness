import { hashCanonical } from "./canonical.js";
import { compareText } from "./tokens.js";
import { leakAssertion, isSealedOracle } from "./oracle.js";
import { matchingRules, type RuleSpec } from "./rules.js";
import { hasUiTag, isEntity, isScreen, LocalEntityTagInheritor } from "./tags.js";
import {
  fieldBool,
  fieldNumber,
  fieldString,
  type OracleLeakPreventedAssertion,
  type SliceEdge,
  type SliceGraph,
  type SliceItem,
  type SliceNode,
} from "./types.js";

const KIND_ORDER = [
  "task",
  "scope",
  "spec_item",
  "edge_case",
  "entity",
  "endpoint",
  "contract",
  "screen",
  "rule",
  "check",
  "research_fact",
  "skill",
  "module_card",
  "failure_mode",
  "feature",
  "tool",
];

export interface Collection {
  readonly items: readonly SliceItem[];
  readonly leaks: readonly OracleLeakPreventedAssertion[];
  readonly hiddenChecks: number;
  readonly effectiveTags: readonly string[];
  readonly goal: string;
  readonly writeScope: readonly string[];
  readonly readScope: readonly string[];
}

export function collectSlice(graph: SliceGraph, catalog: readonly RuleSpec[]): Collection {
  const task = graph.nodes.find((node) => node.id === graph.taskId);
  if (!task) throw new Error(`missing task node ${graph.taskId}`);
  const tags = new LocalEntityTagInheritor().report(graph, task.id);
  const leaks: OracleLeakPreventedAssertion[] = [];
  let hiddenChecks = 0;
  const raw: SliceItem[] = [];
  const goal = task.text.trim() ? task.text : task.title;
  const writeScope = graph.writeScope;
  const readScope = graph.readScope.length > 0 ? graph.readScope : ["anything"];

  raw.push(itemFromNode(task, "task", "must", ["task-objective"], 100, null));
  if (writeScope.length > 0) {
    raw.push(scopeItem("write-scope", "write scope", writeScope.join(" ")));
  }
  raw.push(scopeItem("read-boundary", "read boundary", readScope.join(" ")));

  for (const edge of graph.edges) {
    const otherId = otherEnd(edge, task.id);
    if (!otherId) continue;
    const other = graph.nodes.find((node) => node.id === otherId);
    if (!other) continue;
    if (isSealedOracle(other)) {
      leaks.push(leakAssertion(other, graph.edges));
      if (other.kind === "check") hiddenChecks += 1;
      continue;
    }
    const included = includeDirect(edge, other, tags.effectiveTags);
    if (included) raw.push(included);
  }

  for (const featureId of neighbors(graph, task.id, new Set(["belongs_to"]))) {
    for (const ruleId of neighbors(graph, featureId, new Set(["obeys"]))) {
      const ruleNode = graph.nodes.find((node) => node.id === ruleId);
      if (!ruleNode || isSealedOracle(ruleNode)) continue;
      raw.push(asRule(ruleNode, ["task→feature→rule"], catalog));
    }
  }

  for (const entityId of neighbors(graph, task.id, new Set(["touches", "reads", "writes"]))) {
    const entity = graph.nodes.find((node) => node.id === entityId);
    if (!entity || !isEntity(entity)) continue;
    for (const ruleId of neighbors(graph, entityId, new Set(["obeys"]))) {
      const ruleNode = graph.nodes.find((node) => node.id === ruleId);
      if (!ruleNode || isSealedOracle(ruleNode)) continue;
      raw.push(asRule(ruleNode, ["task→entity→rule"], catalog));
    }
  }

  for (const ruleSpec of matchingRules(tags.effectiveTags, catalog)) {
    const node = graph.nodes.find((candidate) => candidate.id === ruleSpec.id || fieldString(candidate.fields, "ruleId") === ruleSpec.id);
    if (node && isSealedOracle(node)) {
      leaks.push(leakAssertion(node, graph.edges));
      continue;
    }
    if (node) raw.push(asRule(node, ["task→tag→rule"], catalog));
    else raw.push(syntheticRule(ruleSpec, ["task→tag→rule"]));
  }

  for (const card of graph.moduleCards) {
    if (!pathMatches(card.path, writeScope)) continue;
    raw.push({
      id: card.path,
      kind: "module_card",
      title: card.path,
      text: card.summary,
      band: "should",
      version: 1,
      contentHash: hashCanonical({ path: card.path, summary: card.summary, hash: card.fileHash }),
      reasons: ["module-card"],
      relevance: 30,
      contractRole: null,
      synthetic: true,
      pointer: null,
      excerpt: false,
      sealed: false,
    });
  }

  for (const feature of graph.nodes.filter((node) => node.kind === "feature")) {
    if (feature.id === graph.featureId) continue;
    if (!isAdjacentFeature(graph, task.id, graph.featureId, feature.id)) continue;
    raw.push({
      id: feature.id,
      kind: "feature",
      title: feature.title,
      text: "",
      band: "could",
      version: feature.version,
      contentHash: feature.contentHash,
      reasons: ["adjacent-feature"],
      relevance: 0,
      contractRole: null,
      synthetic: false,
      pointer: feature.title,
      excerpt: false,
      sealed: false,
    });
  }

  return {
    items: dedupe(raw),
    leaks,
    hiddenChecks,
    effectiveTags: tags.effectiveTags,
    goal,
    writeScope,
    readScope,
  };
}

function includeDirect(edge: SliceEdge, other: SliceNode, tags: readonly string[]): SliceItem | null {
  if (edge.type === "implements" || edge.type === "handles_edge_case") {
    return itemFromNode(other, normalizeKind(other), "must", ["direct-edge"], relevance(other, 90), null);
  }
  if (edge.type === "consumes_contract" || edge.type === "produces_contract") {
    return itemFromNode(
      other,
      normalizeKind(other) === "endpoint" ? "endpoint" : "contract",
      "must",
      ["direct-edge"],
      relevance(other, 90),
      edge.type === "consumes_contract" ? "consume" : "produce",
    );
  }
  if (edge.type === "obeys") return asRule(other, ["direct-edge"], []);
  if (edge.type === "verifies") {
    return itemFromNode(other, "check", "must", ["direct-edge"], 80, null);
  }
  if (edge.type === "touches" || edge.type === "reads" || edge.type === "writes") {
    if (isScreen(other) && !hasUiTag(tags)) return null;
    const kind = isScreen(other) ? "screen" : isEntity(other) ? "entity" : normalizeKind(other);
    return itemFromNode(other, kind, "must", ["direct-edge"], relevance(other, 80), null);
  }
  if (edge.type === "documents") {
    if (!hasUiTag(tags) || !isScreen(other)) return null;
    return itemFromNode(other, "screen", "must", ["direct-edge"], 70, null);
  }
  if (edge.type === "depends_on" || edge.type === "cites") {
    if (other.kind === "research_fact") {
      if (!fieldBool(other.fields, "verified")) return null;
      return itemFromNode(other, "research_fact", "should", ["direct-edge"], relevance(other, 100), null);
    }
    if (other.kind === "contract" && fieldBool(other.fields, "stub")) {
      return itemFromNode(other, "contract", "should", ["sibling-stub"], relevance(other, 40), null);
    }
    if (other.kind === "feature") {
      return {
        id: other.id,
        kind: "feature",
        title: other.title,
        text: "",
        band: "could",
        version: other.version,
        contentHash: other.contentHash,
        reasons: ["adjacent-feature"],
        relevance: 0,
        contractRole: null,
        synthetic: false,
        pointer: other.title,
        excerpt: false,
        sealed: false,
      };
    }
    if (normalizeKind(other) === "module_card") {
      return itemFromNode(other, "module_card", "should", ["module-card"], relevance(other, 30), null);
    }
  }
  return null;
}

function asRule(node: SliceNode, reasons: readonly string[], catalog: readonly RuleSpec[]): SliceItem {
  const ruleId = fieldString(node.fields, "ruleId") ?? node.id;
  const spec = catalog.find((entry) => entry.id === ruleId);
  const text = node.text.trim() ? node.text : (spec?.text ?? "");
  const title = node.title.trim() ? node.title : (spec?.title ?? ruleId);
  return {
    id: ruleId,
    kind: "rule",
    title,
    text,
    band: "must",
    version: node.version,
    contentHash: node.contentHash,
    reasons: [...reasons],
    relevance: 100,
    contractRole: null,
    synthetic: false,
    pointer: null,
    excerpt: false,
    sealed: false,
  };
}

function syntheticRule(spec: RuleSpec, reasons: readonly string[]): SliceItem {
  return {
    id: spec.id,
    kind: "rule",
    title: spec.title,
    text: spec.text,
    band: "must",
    version: 1,
    contentHash: hashCanonical({ id: spec.id, text: spec.text, title: spec.title }),
    reasons: [...reasons],
    relevance: 100,
    contractRole: null,
    synthetic: true,
    pointer: null,
    excerpt: false,
    sealed: false,
  };
}

function scopeItem(id: string, title: string, text: string): SliceItem {
  return {
    id,
    kind: "scope",
    title,
    text,
    band: "must",
    version: 1,
    contentHash: hashCanonical({ id, text }),
    reasons: ["write-boundary"],
    relevance: 100,
    contractRole: null,
    synthetic: true,
    pointer: null,
    excerpt: false,
    sealed: false,
  };
}

function itemFromNode(
  node: SliceNode,
  kind: string,
  band: SliceItem["band"],
  reasons: readonly string[],
  score: number,
  contractRole: SliceItem["contractRole"],
): SliceItem {
  return {
    id: node.id,
    kind,
    title: node.title,
    text: node.text,
    band,
    version: node.version,
    contentHash: node.contentHash,
    reasons: [...reasons],
    relevance: score,
    contractRole,
    synthetic: false,
    pointer: null,
    excerpt: false,
    sealed: false,
  };
}

function dedupe(items: readonly SliceItem[]): SliceItem[] {
  const map = new Map<string, SliceItem>();
  for (const item of items) {
    const key = item.kind === "rule" ? `rule:${item.id}` : `${item.kind}:${item.id}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item, reasons: unique(item.reasons) });
      continue;
    }
    const preferred = existing.synthetic && !item.synthetic ? item : existing;
    map.set(key, {
      ...preferred,
      reasons: unique([...existing.reasons, ...item.reasons]),
      contractRole: preferred.contractRole ?? item.contractRole,
    });
  }
  return [...map.values()].sort(compareItems);
}

function compareItems(left: SliceItem, right: SliceItem): number {
  if (left.band !== right.band) return bandRank(left.band) - bandRank(right.band);
  const leftKind = KIND_ORDER.indexOf(left.kind);
  const rightKind = KIND_ORDER.indexOf(right.kind);
  const leftRank = leftKind < 0 ? 99 : leftKind;
  const rightRank = rightKind < 0 ? 99 : rightKind;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.band === "should" && right.relevance !== left.relevance) return right.relevance - left.relevance;
  return compareText(left.id, right.id);
}

function bandRank(band: SliceItem["band"]): number {
  if (band === "must") return 0;
  if (band === "should") return 1;
  return 2;
}

function normalizeKind(node: SliceNode): string {
  const arch = fieldString(node.fields, "archKind");
  if (arch === "entity") return "entity";
  if (arch === "screen") return "screen";
  if (arch === "endpoint" || arch === "api" || arch === "seam") return "endpoint";
  if (arch === "module_card") return "module_card";
  return node.kind;
}

function relevance(node: SliceNode, fallback: number): number {
  return fieldNumber(node.fields, "relevance") ?? fallback;
}

function otherEnd(edge: SliceEdge, id: string): string | null {
  if (edge.src === id) return edge.dst;
  if (edge.dst === id) return edge.src;
  return null;
}

function neighbors(graph: SliceGraph, id: string, types: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const edge of graph.edges) {
    if (!types.has(edge.type)) continue;
    const other = otherEnd(edge, id);
    if (other) found.add(other);
  }
  return [...found].sort(compareText);
}

function isAdjacentFeature(graph: SliceGraph, taskId: string, featureId: string | null, candidate: string): boolean {
  return graph.edges.some((edge) => {
    const ends = new Set([edge.src, edge.dst]);
    if (!ends.has(candidate)) return false;
    if (ends.has(taskId)) return true;
    return featureId !== null && ends.has(featureId);
  });
}

function pathMatches(path: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => {
    const prefix = scope.replace(/\/\*\*$/, "").replace(/\*$/, "");
    return path.startsWith(prefix) || prefix.startsWith(path);
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}
