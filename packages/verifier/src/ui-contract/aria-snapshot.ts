import { TextMatchNormalizer } from "./text-match.js";
import type { AriaNode, AriaSnapshotComparison, HintFailureType, MatchMode } from "./types.js";

interface MutableNode {
  role: string;
  name?: string;
  pattern?: string;
  children: MutableNode[];
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseBody(body: string): { role: string; name?: string; pattern?: string } {
  let rest = stripOuterQuotes(body.trim().replace(/:$/, "").trim());
  const roleMatch = /^([A-Za-z][\w-]*)\s*/.exec(rest);
  if (!roleMatch?.[1]) {
    return { role: "generic" };
  }
  const role = roleMatch[1];
  rest = rest.slice(roleMatch[0].length).replace(/^:\s*/, "").replace(/\s*\[[^\]]*\]\s*$/, "").trim();
  if (!rest) return { role };
  if (rest.startsWith('"') || rest.startsWith("'")) {
    const quote = rest[0] ?? '"';
    let name = "";
    for (let index = 1; index < rest.length; index += 1) {
      const char = rest[index];
      if (char === quote) break;
      name += char ?? "";
    }
    return { role, name };
  }
  if (rest.startsWith("/")) {
    const end = rest.lastIndexOf("/");
    if (end > 0) return { role, pattern: rest.slice(1, end) };
  }
  return { role, name: rest };
}

/** Parses a Playwright ARIA snapshot YAML template, including `/regex/` names. */
export function parseAriaSnapshot(source: string): AriaNode[] {
  const lines: { indent: number; body: string }[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    lines.push({ indent, body: trimmed.slice(2).trim() });
  }
  function build(index: number, parentIndent: number): { nodes: MutableNode[]; index: number } {
    const nodes: MutableNode[] = [];
    let cursor = index;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (!line || line.indent <= parentIndent) break;
      const indent = line.indent;
      if (nodes.length > 0 && indent !== (lines[index]?.indent ?? indent)) break;
      const parsed = parseBody(line.body);
      const node: MutableNode = { role: parsed.role, children: [] };
      if (parsed.name !== undefined) node.name = parsed.name;
      if (parsed.pattern !== undefined) node.pattern = parsed.pattern;
      cursor += 1;
      const childIndent = lines[cursor]?.indent ?? -1;
      if (childIndent > indent) {
        const nested = build(cursor, indent);
        node.children = nested.nodes;
        cursor = nested.index;
      }
      nodes.push(node);
    }
    return { nodes, index: cursor };
  }
  return build(0, -1).nodes;
}

function nameMatches(actual: AriaNode, expected: AriaNode, mode: MatchMode, normalizer: TextMatchNormalizer): boolean {
  if (expected.pattern) {
    let expression: RegExp;
    try {
      expression = new RegExp(expected.pattern);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid ARIA snapshot regular expression /${expected.pattern}/: ${detail}`);
    }
    return expression.test(actual.name ?? "");
  }
  if (expected.name === undefined) return true;
  return normalizer.matches(actual.name ?? "", expected.name, mode);
}

function nodeMatches(
  actual: AriaNode,
  expected: AriaNode,
  mode: MatchMode,
  normalizer: TextMatchNormalizer,
): boolean {
  if (actual.role !== expected.role) return false;
  if (!nameMatches(actual, expected, mode, normalizer)) return false;
  if (expected.children.length === 0) return true;
  return matchChildren(actual.children, expected.children, mode, normalizer);
}

function matchChildren(
  actual: readonly AriaNode[],
  expected: readonly AriaNode[],
  mode: MatchMode,
  normalizer: TextMatchNormalizer,
): boolean {
  let cursor = 0;
  for (const expectedNode of expected) {
    let found = -1;
    for (let index = cursor; index < actual.length; index += 1) {
      const candidate = actual[index];
      if (!candidate) continue;
      if (nodeMatches(candidate, expectedNode, mode, normalizer)) {
        found = index;
        break;
      }
    }
    if (found < 0) return false;
    cursor = found + 1;
  }
  return true;
}

/**
 * Partial, order-sensitive ARIA snapshot comparison.
 * This is the host-side `toMatchAriaSnapshot(expected)` check over Playwright's `ariaSnapshot()` YAML.
 */
export function matchAriaSnapshot(
  actual: string,
  expected: string,
  mode: MatchMode = "normalized",
): AriaSnapshotComparison {
  const normalizer = new TextMatchNormalizer();
  const ok = matchChildren(parseAriaSnapshot(actual), parseAriaSnapshot(expected), mode, normalizer);
  return { ok, actual };
}

export async function toMatchAriaSnapshot(
  reader: { ariaSnapshot(): Promise<string> },
  expected: string,
  mode: MatchMode = "normalized",
): Promise<AriaSnapshotComparison> {
  const actual = await reader.ariaSnapshot();
  return matchAriaSnapshot(actual, expected, mode);
}

function walk(nodes: readonly AriaNode[], role: string, into: AriaNode[]): void {
  for (const node of nodes) {
    if (node.role === role) into.push(node);
    walk(node.children, role, into);
  }
}

export function seededRowsFromSnapshot(snapshot: string, headerNames: readonly string[]): string[] {
  const normalizer = new TextMatchNormalizer();
  const headers = new Set(headerNames.map((name) => normalizer.normalize(name)));
  const rows: string[] = [];
  const tables: AriaNode[] = [];
  walk(parseAriaSnapshot(snapshot), "table", tables);
  const roots = tables.length > 0 ? tables : parseAriaSnapshot(snapshot);
  for (const root of roots) {
    const rowNodes: AriaNode[] = [];
    walk(root.role === "table" ? root.children : [root], "row", rowNodes);
    for (const row of rowNodes) {
      const cells = row.children.filter(
        (child) => child.role === "cell" || child.role === "gridcell" || child.role === "columnheader",
      );
      if (cells.length === 0) continue;
      if (cells.every((cell) => cell.role === "columnheader")) continue;
      const values = cells.map((cell) => cell.name ?? "");
      if (values.length > 0 && values.every((value) => headers.has(normalizer.normalize(value)))) continue;
      rows.push(values.join(" · "));
    }
  }
  return rows;
}

export function classifySeededRows(
  actual: readonly string[],
  expected: readonly string[],
  mode: MatchMode = "normalized",
): { readonly ok: true } | { readonly ok: false; readonly failureType: HintFailureType } {
  const normalizer = new TextMatchNormalizer();
  const same = (left: string, right: string) => normalizer.matches(left, right, mode);
  if (actual.length === expected.length && actual.every((row, index) => same(row, expected[index] ?? ""))) {
    return { ok: true };
  }
  if (actual.length < expected.length) return { ok: false, failureType: "missing_item" };
  if (actual.length > expected.length) return { ok: false, failureType: "extra_item" };
  const used = new Set<number>();
  let permutation = true;
  for (const expectedRow of expected) {
    const found = actual.findIndex((row, index) => !used.has(index) && same(row, expectedRow));
    if (found < 0) {
      permutation = false;
      break;
    }
    used.add(found);
  }
  if (permutation) return { ok: false, failureType: "wrong_order" };
  return { ok: false, failureType: "wrong_value" };
}

export function snapshotContainsText(snapshot: string, text: string, mode: MatchMode): boolean {
  const normalizer = new TextMatchNormalizer();
  const nodes = parseAriaSnapshot(snapshot);
  function visit(list: readonly AriaNode[]): boolean {
    for (const node of list) {
      if (node.name && normalizer.matches(node.name, text, mode)) return true;
      if (visit(node.children)) return true;
    }
    return false;
  }
  return visit(nodes);
}
