import { canonicalJson, hashText, sha256Hex } from "./hash.js";
import type { FieldMap, FieldValue, GraphNode } from "./types.js";
import { parseEfFields, YamlSyntaxError } from "./yaml.js";

export const CLOSER = "<!-- /ef:node -->";
const ESCAPED_CLOSER = "<!-- ef:escaped /ef:node -->";
const OPEN_PREFIX = "<!-- ef:node ";
const ESCAPED_OPEN = "<!-- ef:escaped ef:node ";

const OPEN_PATTERN = /^<!-- ef:node id=(\S+) rev=(\d+) base_hash=([0-9a-f]{64}) -->$/;

export interface ParsedNodeBlock {
  readonly nodeId: string;
  readonly rev: number;
  readonly baseHash: string;
  readonly title: string;
  readonly prose: string;
  readonly fields: FieldMap | null;
  readonly keyLines: ReadonlyMap<string, number>;
  readonly yamlError: { readonly line: number; readonly message: string; readonly code: "syntax" | "unsafe" | "limit" } | null;
  readonly startLine: number;
}

export interface UnmarkedSection {
  readonly heading: string;
  readonly prose: string;
  readonly fields: FieldMap | null;
  readonly keyLines: ReadonlyMap<string, number>;
  readonly yamlError: { readonly line: number; readonly message: string; readonly code: "syntax" | "unsafe" | "limit" } | null;
  readonly line: number;
}

export interface ParsedViewFile {
  readonly featureId: string | null;
  readonly efFile: string | null;
  readonly title: string;
  readonly nodes: readonly ParsedNodeBlock[];
  readonly unmarked: readonly UnmarkedSection[];
  readonly syntaxErrors: readonly { readonly line: number; readonly message: string; readonly code: "syntax" | "unsafe" | "limit" }[];
}

export function escapeMarkerText(value: string): string {
  return value.replaceAll(CLOSER, ESCAPED_CLOSER).replaceAll(OPEN_PREFIX, ESCAPED_OPEN);
}

export function unescapeMarkerText(value: string): string {
  return value.replaceAll(ESCAPED_CLOSER, CLOSER).replaceAll(ESCAPED_OPEN, OPEN_PREFIX);
}

export function renderFields(fields: FieldMap): string {
  const lines = ["```ef-fields"];
  for (const key of Object.keys(fields).sort()) {
    lines.push(`${key}: ${renderFlow(fields[key])}`);
  }
  lines.push("```");
  return lines.join("\n");
}

export function blockInterior(node: Pick<GraphNode, "title" | "text" | "fields">): string {
  const prose = node.text.replace(/\n$/, "");
  return [`## ${escapeMarkerText(node.title)}`, "", escapeMarkerText(prose), "", renderFields(node.fields), ""].join("\n");
}

export function renderNodeBlock(node: GraphNode): { text: string; baseHash: string; fieldsSha256: string; proseSha256: string } {
  const interior = blockInterior(node);
  const baseHash = sha256Hex(interior);
  const text = [`<!-- ef:node id=${node.id} rev=${String(node.version)} base_hash=${baseHash} -->`, interior, CLOSER].join("\n");
  return {
    text,
    baseHash,
    fieldsSha256: sha256Hex(canonicalJson(node.fields)),
    proseSha256: sha256Hex(node.text.replace(/\n$/, "")),
  };
}

export function renderViewFile(input: {
  readonly efFile: string;
  readonly featureId: string | null;
  readonly efRevision: number;
  readonly title: string;
  readonly nodes: readonly GraphNode[];
}): { text: string; blocks: readonly ReturnType<typeof renderNodeBlock>[] } {
  const blocks = [...input.nodes]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((node) => renderNodeBlock(node));
  const front = [
    "---",
    `ef_file: ${input.efFile}`,
    `feature_id: ${input.featureId ?? ""}`,
    `ef_revision: ${String(input.efRevision)}`,
    "---",
    `# ${input.title}`,
    "",
  ];
  const body = blocks.map((block) => block.text).join("\n\n");
  const text = `${front.join("\n")}${body}${body ? "\n" : ""}`;
  return { text, blocks };
}

export function parseViewFile(text: string): ParsedViewFile {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  const syntaxErrors: ParsedViewFile["syntaxErrors"][number][] = [];
  let cursor = 0;
  const meta: Record<string, string> = {};
  if (lines[0] === "---") {
    cursor = 1;
    while (cursor < lines.length && lines[cursor] !== "---") {
      const line = lines[cursor] ?? "";
      const match = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
      if (match?.[1]) meta[match[1]] = match[2] ?? "";
      cursor += 1;
    }
    if (lines[cursor] === "---") cursor += 1;
  }
  const nodes: ParsedNodeBlock[] = [];
  const unmarked: UnmarkedSection[] = [];
  let fileTitle = "";
  while (cursor < lines.length) {
    const line = lines[cursor] ?? "";
    const open = OPEN_PATTERN.exec(line);
    if (open?.[1] && open[2] && open[3]) {
      const startLine = cursor + 1;
      const bodyStart = cursor + 1;
      let close = -1;
      for (let index = bodyStart; index < lines.length; index += 1) {
        if (lines[index] === CLOSER) {
          close = index;
          break;
        }
      }
      if (close < 0) {
        syntaxErrors.push({ line: startLine, message: "unclosed ef:node block", code: "syntax" });
        break;
      }
      const rawBody = lines.slice(bodyStart, close).join("\n");
      nodes.push(parseBlock(open[1], Number(open[2]), open[3], unescapeMarkerText(rawBody), startLine + 1));
      cursor = close + 1;
      continue;
    }
    if (line.startsWith("# ")) {
      fileTitle = line.slice(2).trim();
      cursor += 1;
      continue;
    }
    if (line.startsWith("## ")) {
      const sectionStart = cursor;
      let sectionEnd = lines.length;
      for (let index = cursor + 1; index < lines.length; index += 1) {
        const candidate = lines[index] ?? "";
        if (candidate.startsWith("## ") || OPEN_PATTERN.test(candidate)) {
          sectionEnd = index;
          break;
        }
      }
      unmarked.push(parseUnmarked(lines.slice(sectionStart, sectionEnd).join("\n"), sectionStart + 1));
      cursor = sectionEnd;
      continue;
    }
    cursor += 1;
  }
  const featureRaw = meta.feature_id ?? "";
  return {
    featureId: featureRaw.trim() === "" ? null : featureRaw.trim(),
    efFile: meta.ef_file ?? null,
    title: fileTitle,
    nodes,
    unmarked,
    syntaxErrors,
  };
}

export function fileHash(text: string): string {
  return hashText(text);
}

function parseBlock(nodeId: string, rev: number, baseHash: string, body: string, bodyStartLine: number): ParsedNodeBlock {
  const extracted = extractHeadingAndFields(body, bodyStartLine);
  return {
    nodeId,
    rev,
    baseHash,
    title: extracted.heading,
    prose: extracted.prose,
    fields: extracted.fields,
    keyLines: extracted.keyLines,
    yamlError: extracted.yamlError,
    startLine: bodyStartLine,
  };
}

function parseUnmarked(body: string, startLine: number): UnmarkedSection {
  const extracted = extractHeadingAndFields(body, startLine);
  return {
    heading: extracted.heading,
    prose: extracted.prose,
    fields: extracted.fields,
    keyLines: extracted.keyLines,
    yamlError: extracted.yamlError,
    line: startLine,
  };
}

function extractHeadingAndFields(body: string, bodyStartLine: number): {
  heading: string;
  prose: string;
  fields: FieldMap | null;
  keyLines: Map<string, number>;
  yamlError: ParsedNodeBlock["yamlError"];
} {
  const lines = body.split("\n");
  let heading = "";
  let headingIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("## ")) {
      heading = line.slice(3).trim();
      headingIndex = index;
      break;
    }
  }
  const fence = findFence(lines);
  let fields: FieldMap | null = null;
  let keyLines = new Map<string, number>();
  let yamlError: ParsedNodeBlock["yamlError"] = null;
  if (!fence) {
    yamlError = { line: bodyStartLine, message: "missing ef-fields block", code: "syntax" };
  } else {
    const interior = lines.slice(fence.open + 1, fence.close).join("\n");
    const interiorStart = bodyStartLine + fence.open + 1;
    try {
      const parsed = parseEfFields(interior, interiorStart);
      fields = parsed.fields;
      keyLines = parsed.keyLines;
    } catch (error) {
      if (error instanceof YamlSyntaxError) {
        yamlError = { line: error.line, message: error.message, code: error.code };
      } else {
        throw error;
      }
    }
  }
  const proseLines = lines.filter((_line, index) => {
    if (index === headingIndex) return false;
    if (fence && index >= fence.open && index <= fence.close) return false;
    return true;
  });
  const prose = trimProse(proseLines.join("\n"));
  return { heading, prose, fields, keyLines, yamlError };
}

function findFence(lines: readonly string[]): { open: number; close: number } | null {
  const open = lines.findIndex((line) => line.trim() === "```ef-fields");
  if (open < 0) return null;
  for (let index = open + 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim() === "```") return { open, close: index };
  }
  return null;
}

function trimProse(value: string): string {
  return value.replace(/^\n+/, "").replace(/\n+$/, "");
}

function renderFlow(value: FieldValue | undefined): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => renderFlow(item)).join(", ")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}: ${renderFlow(value[key])}`).join(", ")}}`;
}
