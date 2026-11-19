import { DuplicateQueryNameError, ParameterMismatchError } from "./errors.js";
import { isPositionalParams, type SqlParams, type SqlValue } from "./values.js";

export interface SqlInspection {
  readonly attach: boolean;
  readonly deferredBegin: boolean;
  readonly immediateBegin: boolean;
}

export interface ExtractedSqlParameters {
  /** Named placeholders with the prefix used in SQL, first-seen order, duplicates removed. */
  readonly named: readonly string[];
  readonly positional: number;
}

export interface ParsedQuery {
  readonly name: string;
  readonly sql: string;
  /** Bare `:param` names in first-seen order. */
  readonly params: readonly string[];
}

const NAMED_PARAMETER = /[:@$][A-Za-z_][A-Za-z0-9_]*/g;
const POSITIONAL_PARAMETER = /\?(?!\d)\d*|\?\d+/g;

export function isMemoryLocation(location: string): boolean {
  const trimmed = location.trim();
  if (trimmed === ":memory:") return true;
  const lower = trimmed.toLowerCase();
  if (lower.includes("mode=memory")) return true;
  return lower.startsWith("file:") && lower.includes(":memory:");
}

export function stripSqlCommentsAndStrings(sql: string): string {
  let out = "";
  let index = 0;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", index);
      index = end === -1 ? sql.length : end;
      out += " ";
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    if (char === "'") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sql[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      out += "''";
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

export function inspectSql(sql: string): SqlInspection {
  const statements = splitStatements(stripSqlCommentsAndStrings(sql));
  let attach = false;
  let deferredBegin = false;
  let immediateBegin = false;
  for (const statement of statements) {
    const trimmed = statement.trim();
    if (trimmed === "") continue;
    if (/\battach\b/i.test(trimmed)) attach = true;
    const begin = /^\s*begin\b(?:\s+(deferred|immediate|exclusive))?(?:\s+transaction)?\s*$/i.exec(
      trimmed,
    );
    if (!begin) continue;
    const mode = (begin[1] ?? "deferred").toLowerCase();
    if (mode === "immediate" || mode === "exclusive") immediateBegin = true;
    else deferredBegin = true;
  }
  return { attach, deferredBegin, immediateBegin };
}

export function extractSqlParameters(sql: string): ExtractedSqlParameters {
  const stripped = stripSqlCommentsAndStrings(sql);
  const named: string[] = [];
  const seen = new Set<string>();
  for (const match of stripped.matchAll(NAMED_PARAMETER)) {
    const token = match[0];
    if (token === undefined) continue;
    const bare = token.slice(1).toLowerCase();
    if (seen.has(bare)) continue;
    seen.add(bare);
    named.push(token);
  }
  let positional = 0;
  for (const _match of stripped.matchAll(POSITIONAL_PARAMETER)) {
    positional += 1;
    void _match;
  }
  return { named, positional };
}

export function bareParameterName(token: string): string {
  return token.replace(/^[:@$]/, "");
}

export function bindParameters(sql: string, params: SqlParams | undefined, queryName?: string): SqlParams | undefined {
  const extracted = extractSqlParameters(sql);
  if (extracted.named.length === 0 && extracted.positional === 0) {
    const extra = extraKeys(params);
    if (extra.length > 0) {
      throw new ParameterMismatchError([], [], extra, queryName);
    }
    return undefined;
  }
  if (extracted.named.length > 0) {
    if (isPositionalParams(params)) {
      throw new ParameterMismatchError(
        extracted.named.map(bareParameterName),
        extracted.named.map(bareParameterName),
        [],
        queryName,
      );
    }
    const named = params === undefined ? {} : params;
    return normalizeNamedParameters(extracted.named, named, queryName);
  }
  const values = isPositionalParams(params) ? [...params] : [];
  if (values.length !== extracted.positional) {
    throw new ParameterMismatchError(
      Array.from({ length: extracted.positional }, (_unused, index) => `?${index + 1}`),
      values.length < extracted.positional
        ? Array.from({ length: extracted.positional - values.length }, (_unused, index) => `?${values.length + index + 1}`)
        : [],
      values.length > extracted.positional ? values.slice(extracted.positional).map((_value, index) => `extra[${index}]`) : [],
      queryName,
    );
  }
  return values;
}

export function parseQueryCatalog(sql: string): readonly ParsedQuery[] {
  const queries: ParsedQuery[] = [];
  const seen = new Set<string>();
  for (const block of sql.split(/^-- name: /m).slice(1)) {
    const newline = block.indexOf("\n");
    const name = (newline === -1 ? block : block.slice(0, newline)).trim();
    const body = newline === -1 ? "" : block.slice(newline + 1);
    const statement = body
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    if (name === "") {
      throw new DuplicateQueryNameError("(blank)");
    }
    if (seen.has(name)) throw new DuplicateQueryNameError(name);
    seen.add(name);
    const params = extractSqlParameters(statement).named.map(bareParameterName);
    queries.push({ name, sql: statement, params });
  }
  return queries;
}

export function isMutatingSql(sql: string): boolean {
  const statements = splitStatements(stripSqlCommentsAndStrings(sql));
  return statements.some((statement) =>
    /^(insert|update|delete|replace|commit)\b/i.test(statement.trim()),
  );
}

function splitStatements(sql: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const char of sql) {
    if (char === ";") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() !== "") parts.push(current);
  return parts;
}

function normalizeNamedParameters(
  expectedTokens: readonly string[],
  params: Record<string, SqlValue>,
  queryName?: string,
): Record<string, SqlValue> {
  const expected = expectedTokens.map(bareParameterName);
  const missing: string[] = [];
  const extra: string[] = [];
  const usedKeys = new Set<string>();
  const bound: Record<string, SqlValue> = {};
  for (const name of expected) {
    const key = findParameterKey(params, name);
    const value = key === undefined ? undefined : params[key];
    if (key === undefined || value === undefined) {
      missing.push(name);
      continue;
    }
    usedKeys.add(key);
    const token = expectedTokens.find((candidate) => bareParameterName(candidate) === name) ?? `:${name}`;
    bound[token] = value;
  }
  for (const key of Object.keys(params)) {
    if (!usedKeys.has(key)) extra.push(key);
  }
  if (missing.length > 0 || extra.length > 0) {
    throw new ParameterMismatchError(expected, missing, extra.sort(), queryName);
  }
  return bound;
}

function findParameterKey(params: Record<string, SqlValue>, bare: string): string | undefined {
  const candidates = [bare, `:${bare}`, `@${bare}`, `$${bare}`];
  return candidates.find((key) => Object.prototype.hasOwnProperty.call(params, key));
}

function extraKeys(params: SqlParams | undefined): string[] {
  if (params === undefined) return [];
  if (isPositionalParams(params)) {
    return params.length === 0 ? [] : params.map((_value, index) => `extra[${index}]`);
  }
  return Object.keys(params);
}
