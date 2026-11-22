import type { DdlStatement } from "./types.js";

export function splitSql(sql: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const ch = sql[index] ?? "";
    if (quote) {
      current += ch;
      if (ch === quote) {
        if (sql[index + 1] === quote) {
          current += sql[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "-" && sql[index + 1] === "-") {
      const end = sql.indexOf("\n", index);
      index = end === -1 ? sql.length : end;
      continue;
    }
    if (ch === ";") {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function parseDdl(sql: string): DdlStatement[] {
  return splitSql(sql).map((statement) => parseStatement(statement));
}

export function createdTables(statements: readonly DdlStatement[]): string[] {
  return statements.flatMap((statement) =>
    statement.kind === "create_table" && statement.name ? [statement.name] : [],
  );
}

function parseStatement(raw: string): DdlStatement {
  const text = raw.replace(/\s+/g, " ").trim();
  const createTable = /^create\s+table\s+(?:if\s+not\s+exists\s+)?(.+)$/i.exec(text);
  if (createTable?.[1]) {
    const parsed = takeIdent(createTable[1]);
    const body = parsed.rest;
    const foreign = foreignKeysInCreate(body);
    const firstFk = foreign[0];
    return statement({
      kind: "create_table",
      raw,
      destructive: false,
      name: parsed.name,
      table: parsed.name,
      columns: foreign.flatMap((item) => item.columns),
      targetTable: firstFk?.target ?? null,
    });
  }
  const createIndex =
    /^create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(\S+)\s+on\s+(\S+)\s*\(([^)]*)\)/i.exec(text);
  if (createIndex?.[1] && createIndex[2]) {
    return statement({
      kind: "create_index",
      raw,
      destructive: false,
      name: unquote(createIndex[1]),
      table: unquote(createIndex[2]),
      columns: splitColumns(createIndex[3] ?? ""),
    });
  }
  const createEnum = /^create\s+type\s+(\S+)\s+as\s+enum\s*\(([^)]*)\)/i.exec(text);
  if (createEnum?.[1]) {
    return statement({
      kind: "create_enum",
      raw,
      destructive: false,
      name: unquote(createEnum[1]),
    });
  }
  const addColumn = /^alter\s+table\s+(\S+)\s+add\s+column\s+(\S+)(?:\s+(.+))?$/i.exec(text);
  if (addColumn?.[1] && addColumn[2]) {
    const columnType = (addColumn[3] ?? "").trim() || null;
    const references = /\breferences\s+(\S+)/i.exec(columnType ?? "");
    return statement({
      kind: references ? "add_foreign_key" : "add_column",
      raw,
      destructive: false,
      table: unquote(addColumn[1]),
      column: unquote(addColumn[2]),
      columns: [unquote(addColumn[2])],
      columnType,
      targetTable: references?.[1] ? unquote(references[1]) : null,
    });
  }
  const dropColumn = /^alter\s+table\s+(\S+)\s+drop\s+column\s+(\S+)/i.exec(text);
  if (dropColumn?.[1] && dropColumn[2]) {
    return statement({
      kind: "drop_column",
      raw,
      destructive: true,
      table: unquote(dropColumn[1]),
      column: unquote(dropColumn[2]),
      columns: [unquote(dropColumn[2])],
    });
  }
  const renameColumn = /^alter\s+table\s+(\S+)\s+rename\s+column\s+(\S+)\s+to\s+(\S+)/i.exec(text);
  if (renameColumn?.[1] && renameColumn[2] && renameColumn[3]) {
    return statement({
      kind: "rename_column",
      raw,
      destructive: true,
      table: unquote(renameColumn[1]),
      column: unquote(renameColumn[2]),
      columns: [unquote(renameColumn[2])],
      renamedTo: unquote(renameColumn[3]),
    });
  }
  const renameTable = /^alter\s+table\s+(\S+)\s+rename\s+to\s+(\S+)/i.exec(text);
  if (renameTable?.[1] && renameTable[2]) {
    return statement({
      kind: "rename_table",
      raw,
      destructive: true,
      table: unquote(renameTable[1]),
      name: unquote(renameTable[1]),
      renamedTo: unquote(renameTable[2]),
    });
  }
  const addFk =
    /^alter\s+table\s+(\S+)\s+add\s+constraint\s+(\S+)\s+foreign\s+key\s*\(([^)]*)\)\s+references\s+(\S+)/i.exec(
      text,
    );
  if (addFk?.[1] && addFk[2] && addFk[4]) {
    return statement({
      kind: "add_foreign_key",
      raw,
      destructive: false,
      name: unquote(addFk[2]),
      table: unquote(addFk[1]),
      columns: splitColumns(addFk[3] ?? ""),
      targetTable: unquote(addFk[4]),
    });
  }
  const alterColumn = /^alter\s+table\s+(\S+)\s+alter\s+column\s+(\S+)/i.exec(text);
  if (alterColumn?.[1] && alterColumn[2]) {
    return statement({
      kind: "alter_column",
      raw,
      destructive: true,
      table: unquote(alterColumn[1]),
      column: unquote(alterColumn[2]),
      columns: [unquote(alterColumn[2])],
    });
  }
  const dropTable = /^drop\s+table\s+(?:if\s+exists\s+)?(\S+)/i.exec(text);
  if (dropTable?.[1]) {
    return statement({
      kind: "drop_table",
      raw,
      destructive: true,
      name: unquote(dropTable[1]),
      table: unquote(dropTable[1]),
    });
  }
  return statement({ kind: "other", raw, destructive: false });
}

function statement(input: {
  readonly kind: DdlStatement["kind"];
  readonly raw: string;
  readonly destructive: boolean;
  readonly name?: string | null;
  readonly table?: string | null;
  readonly column?: string | null;
  readonly columns?: readonly string[];
  readonly columnType?: string | null;
  readonly targetTable?: string | null;
  readonly renamedTo?: string | null;
}): DdlStatement {
  return {
    kind: input.kind,
    raw: input.raw,
    destructive: input.destructive,
    name: input.name ?? null,
    table: input.table ?? null,
    column: input.column ?? null,
    columns: input.columns ?? [],
    columnType: input.columnType ?? null,
    targetTable: input.targetTable ?? null,
    renamedTo: input.renamedTo ?? null,
  };
}

function foreignKeysInCreate(body: string): { columns: string[]; target: string }[] {
  const found: { columns: string[]; target: string }[] = [];
  const inline = /\b(\w+)\s+[a-z][\w]*(?:\([^)]*\))?(?:\s+\w+)*\s+references\s+(\w+)/gi;
  for (const match of body.matchAll(inline)) {
    if (match[1] && match[2]) found.push({ columns: [match[1]], target: match[2] });
  }
  const tableLevel = /foreign\s+key\s*\(([^)]*)\)\s+references\s+(\w+)/gi;
  for (const match of body.matchAll(tableLevel)) {
    if (match[1] && match[2]) found.push({ columns: splitColumns(match[1]), target: match[2] });
  }
  return found;
}

function splitColumns(value: string): string[] {
  return value
    .split(",")
    .map((part) => unquote(part.trim().split(/\s+/)[0] ?? ""))
    .filter((part) => part.length > 0);
}

function takeIdent(input: string): { name: string; rest: string } {
  const trimmed = input.trim();
  const quoted = /^(["'`])(.+?)\1([\s\S]*)$/.exec(trimmed);
  if (quoted?.[2]) return { name: quoted[2], rest: quoted[3] ?? "" };
  const bare = /^([A-Za-z_][A-Za-z0-9_]*)([\s\S]*)$/.exec(trimmed);
  if (bare?.[1]) return { name: bare[1], rest: bare[2] ?? "" };
  const token = trimmed.split(/\s+/)[0] ?? "unknown";
  return { name: unquote(token), rest: trimmed.slice(token.length) };
}

function unquote(value: string): string {
  let trimmed = value.trim().replace(/[;,]$/, "");
  trimmed = trimmed.replace(/\([^)]*\)$/, "");
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
