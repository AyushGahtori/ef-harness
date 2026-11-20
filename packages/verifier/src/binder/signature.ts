import { BindingDefectError } from "./errors.js";
import type { ContractEntrySpec, StubKind } from "./types.js";

export interface ParsedParam {
  name: string;
  type: string;
  optional: boolean;
  rest: boolean;
}

export interface ParsedSignature {
  async: boolean;
  name: string;
  params: readonly ParsedParam[];
  returnType: string;
  raw: string;
}

const SIGNATURE =
  /^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*:\s*([\s\S]+?)\s*$/;

const PARAM =
  /^(\.\.\.)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]+)$/;

const TYPE_KEYWORDS = new Set([
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "undefined",
  "null",
  "void",
  "never",
  "unknown",
  "any",
  "object",
  "Promise",
  "Array",
  "ReadonlyArray",
  "Record",
  "Partial",
  "Required",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "Map",
  "Set",
  "Date",
  "Error",
  "Request",
  "Response",
  "Readonly",
  "Iterable",
  "Iterator",
  "AsyncIterable",
  "Buffer",
  "Uint8Array",
  "readonly",
  "unique",
  "keyof",
  "typeof",
  "infer",
  "as",
  "is",
  "true",
  "false",
]);

export function parseSignature(signature: string): ParsedSignature | undefined {
  const match = SIGNATURE.exec(signature.trim());
  if (!match) return undefined;
  const name = match[2];
  const returnType = match[4]?.trim();
  if (!name || !returnType) return undefined;
  const params: ParsedParam[] = [];
  for (const part of splitParams(match[3] ?? "")) {
    const param = PARAM.exec(part);
    if (!param) return undefined;
    const paramName = param[2];
    const paramType = param[4]?.trim();
    if (!paramName || !paramType) return undefined;
    params.push({
      name: paramName,
      type: paramType,
      optional: param[3] === "?",
      rest: param[1] === "...",
    });
  }
  return {
    async: Boolean(match[1]),
    name,
    params,
    returnType,
    raw: signature.trim(),
  };
}

export function requireSignature(entry: ContractEntrySpec): ParsedSignature {
  const parsed = parseSignature(entry.signature);
  if (!parsed || parsed.name !== entry.exportName) {
    throw new BindingDefectError(
      "invalid_signature",
      `Contract entry ${entry.name} has no parseable declared signature`,
      "non_behavioral",
    );
  }
  return parsed;
}

export function namedTypes(parsed: ParsedSignature): string[] {
  const found = new Set<string>();
  const texts = [parsed.returnType, ...parsed.params.map((param) => param.type)];
  for (const text of texts) {
    for (const match of text.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
      const name = match[0];
      if (!name || TYPE_KEYWORDS.has(name)) continue;
      found.add(name);
    }
  }
  return [...found];
}

export function stubKindOf(entry: ContractEntrySpec): StubKind {
  if (entry.stubKind) return entry.stubKind;
  if (entry.kind === "route" || entry.route) return "route";
  if (entry.jobName) return "job";
  return "function";
}

function splitParams(params: string): string[] {
  const parts: string[] = [];
  let current = "";
  let angle = 0;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (const ch of params) {
    if (ch === "<") angle += 1;
    else if (ch === ">") angle = Math.max(0, angle - 1);
    else if (ch === "(") paren += 1;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "{") brace += 1;
    else if (ch === "}") brace = Math.max(0, brace - 1);
    else if (ch === "[") bracket += 1;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    if (ch === "," && angle === 0 && paren === 0 && brace === 0 && bracket === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
