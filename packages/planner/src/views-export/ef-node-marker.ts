import { compareText, digestSha256 } from "./canonical-hash.js";
import { emitYamlDocument } from "./yaml-block.js";

export const EF_NODE_CLOSER = "<!-- /ef:node -->";

const CLOSER_LITERAL = "<!-- /ef:node -->";
const OPENER_LITERAL = "<!-- ef:node ";

export interface EfFieldLink {
  readonly type: string;
  readonly dst: string;
  readonly pin: number | null;
}

export interface EfNodeBlockInput {
  readonly id: string;
  readonly anchor: string;
  readonly version: number;
  readonly baseHash: string;
  readonly title: string;
  readonly prose: string;
  readonly kind: string;
  readonly status: string;
  readonly basis: string | null;
  readonly owner: string | null;
  readonly touches: readonly string[];
  readonly bounds: Readonly<Record<string, number>> | null;
  readonly links: readonly EfFieldLink[];
  readonly extraFields: Readonly<Record<string, unknown>>;
  readonly markdownLinks: readonly string[];
}

export interface FormattedEfNode {
  readonly block: string;
  readonly fieldsYaml: string;
  readonly prose: string;
  readonly fieldsSha256: string;
  readonly proseSha256: string;
  readonly contentSha256: string;
}

export interface ParsedEfNode {
  readonly id: string;
  readonly rev: number;
  readonly baseHash: string;
  readonly body: string;
  readonly fieldsYaml: string;
  readonly prose: string;
}

const OPENER_LINE = /^<!-- ef:node id=(\S+) rev=(\d+) base_hash=(\S+) -->$/;

const RESERVED_FIELD_KEYS = new Set([
  "id",
  "kind",
  "status",
  "basis",
  "owner",
  "touches",
  "bounds",
  "links",
  "min",
  "max",
  "minimum",
  "maximum",
  "lower",
  "upper",
  "prose",
  "text",
  "body",
  "markdown",
  "display_order",
]);

export class EfNodeMarkerFormatter {
  formatBlock(input: EfNodeBlockInput): FormattedEfNode {
    assertMarkerToken(input.id, "node id");
    assertMarkerToken(input.anchor, "anchor");
    assertMarkerToken(input.baseHash, "base_hash");
    if (!Number.isSafeInteger(input.version) || input.version < 1) {
      throw new Error(`ef:node rev must be a positive integer for ${input.id}`);
    }
    const fields = buildFields(input);
    const fieldsYaml = escapeMarkerText(emitYamlDocument(fields).replace(/\n$/, ""));
    const prose = escapeMarkerText(input.prose.replaceAll("\r\n", "\n").replaceAll("\r", "\n"));
    const title = escapeMarkerText(input.title.replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " "));
    const lines = [
      `<!-- ef:node id=${input.id} rev=${String(input.version)} base_hash=${input.baseHash} -->`,
      `<a id="${input.anchor}"></a>`,
      `## ${title}`,
      "",
      prose,
      "",
      "```ef-fields",
      fieldsYaml,
      "```",
    ];
    if (input.markdownLinks.length > 0) {
      lines.push("");
      for (const link of input.markdownLinks) lines.push(escapeMarkerText(link));
    }
    lines.push(EF_NODE_CLOSER);
    const block = lines.join("\n");
    return {
      block,
      fieldsYaml,
      prose,
      fieldsSha256: digestSha256(fieldsYaml),
      proseSha256: digestSha256(prose),
      contentSha256: digestSha256(block),
    };
  }
}

export function escapeMarkerText(text: string): string {
  return text.replaceAll(CLOSER_LITERAL, "\\<!-- /ef:node -->").replaceAll(OPENER_LITERAL, "\\<!-- ef:node ");
}

export function unescapeMarkerText(text: string): string {
  return text
    .replaceAll("\\<!-- /ef:node -->", CLOSER_LITERAL)
    .replaceAll("\\<!-- ef:node ", OPENER_LITERAL)
    .replaceAll("<!-- ef:escaped /ef:node -->", CLOSER_LITERAL)
    .replaceAll("<!-- ef:escaped ef:node ", OPENER_LITERAL);
}

export function parseEfNodeBlocks(markdown: string): ParsedEfNode[] {
  const lines = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const blocks: ParsedEfNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opened = OPENER_LINE.exec(lines[index] ?? "");
    if (!opened) continue;
    let end = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor] === EF_NODE_CLOSER) {
        end = cursor;
        break;
      }
    }
    const id = opened[1] ?? "";
    if (end < 0) {
      throw new Error(`unclosed ef:node ${id}`);
    }
    const body = lines.slice(index + 1, end).join("\n");
    const fieldsYaml = extractFields(body);
    const prose = extractProse(body);
    blocks.push({
      id,
      rev: Number(opened[2]),
      baseHash: opened[3] ?? "",
      body,
      fieldsYaml,
      prose,
    });
    index = end;
  }
  return blocks;
}

export function extractNumericBounds(fields: Readonly<Record<string, unknown>>): Record<string, number> | null {
  const bounds: Record<string, number> = {};
  const nested = fields.bounds;
  if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
    for (const key of Object.keys(nested).sort(compareText)) {
      const value = (nested as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value)) bounds[key] = Object.is(value, -0) ? 0 : value;
    }
  }
  for (const key of ["min", "max", "minimum", "maximum", "lower", "upper"]) {
    const value = fields[key];
    if (typeof value === "number" && Number.isFinite(value)) bounds[key] = Object.is(value, -0) ? 0 : value;
  }
  return Object.keys(bounds).length > 0 ? bounds : null;
}

export function extractTouches(fields: Readonly<Record<string, unknown>>): string[] {
  const value = fields.touches;
  if (!Array.isArray(value)) return [];
  const touches = value.filter((entry): entry is string => typeof entry === "string");
  return [...new Set(touches)].sort(compareText);
}

function buildFields(input: EfNodeBlockInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    basis: input.basis,
    id: input.id,
    kind: input.kind,
    links: input.links.map((link) => {
      const record: Record<string, unknown> = { dst: link.dst, type: link.type };
      if (link.pin !== null) record.pin = link.pin;
      return record;
    }),
    owner: input.owner,
    status: input.status,
    touches: [...input.touches],
  };
  if (input.bounds) fields.bounds = input.bounds;
  for (const key of Object.keys(input.extraFields).sort(compareText)) {
    if (RESERVED_FIELD_KEYS.has(key)) continue;
    fields[key] = input.extraFields[key];
  }
  return fields;
}

function extractFields(body: string): string {
  const match = /```ef-fields\n([\s\S]*?)\n```/.exec(body);
  return match?.[1] ?? "";
}

function extractProse(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## "));
  if (start < 0) return "";
  const fence = lines.findIndex((line, index) => index > start && line === "```ef-fields");
  if (fence < 0) return "";
  return lines.slice(start + 2, fence - 1).join("\n");
}

function assertMarkerToken(value: string, label: string): void {
  if (value.length === 0 || /\s/.test(value) || value.includes(">") || value.includes("<!--")) {
    throw new Error(`${label} cannot contain whitespace, '>' or a comment opener`);
  }
}
