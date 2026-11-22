import { compareTypes, makeOp } from "./ops.js";
import type { DiffOp } from "./types.js";

interface SqlColumn {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly hasDefault: boolean;
  readonly defaultValue: string;
  readonly check: string;
}

interface SqlTable {
  readonly name: string;
  readonly columns: readonly SqlColumn[];
  readonly ddl: string;
}

export function diffSql(before: string, after: string): DiffOp[] {
  if (before.trim() === after.trim()) return [];
  const beforeCatalog = buildCatalog(before, null);
  const afterCatalog = buildCatalog(after, beforeCatalog);
  return diffCatalogs(beforeCatalog, afterCatalog);
}

function buildCatalog(sql: string, base: ReadonlyMap<string, SqlTable> | null): Map<string, SqlTable> {
  const statements = splitStatements(stripComments(sql));
  const hasCreate = statements.some((statement) => /^create\s+table\b/i.test(statement));
  const catalog = new Map<string, SqlTable>();
  if (!hasCreate && base && statements.some((statement) => /^(alter|drop)\s+/i.test(statement))) {
    for (const [name, table] of base) catalog.set(name, cloneTable(table));
  }
  for (const statement of statements) applyStatement(catalog, statement);
  return catalog;
}

function diffCatalogs(before: ReadonlyMap<string, SqlTable>, after: ReadonlyMap<string, SqlTable>): DiffOp[] {
  const ops: DiffOp[] = [];
  const removedTables = [...before.keys()].filter((name) => !after.has(name));
  const addedTables = [...after.keys()].filter((name) => !before.has(name));
  if (removedTables.length === 1 && addedTables.length === 1) {
    const from = removedTables[0];
    const to = addedTables[0];
    if (from && to) {
      ops.push(makeOp("rename_table", true, `rename table ${from} to ${to}`, { from, to }));
      const fromTable = before.get(from);
      const toTable = after.get(to);
      if (fromTable && toTable) ops.push(...diffColumns(to, fromTable.columns, toTable.columns));
    }
  } else {
    for (const name of removedTables) {
      ops.push(makeOp("drop_table", true, `drop table ${name}`, { table: name }));
    }
    for (const name of addedTables) {
      const table = after.get(name);
      ops.push(
        makeOp("add_table", false, `add table ${name}`, {
          table: name,
          ddl: table?.ddl ?? `CREATE TABLE ${name} ()`,
        }),
      );
    }
  }
  for (const [name, table] of after) {
    const prior = before.get(name);
    if (!prior) continue;
    ops.push(...diffColumns(name, prior.columns, table.columns));
  }
  return ops;
}

function diffColumns(table: string, before: readonly SqlColumn[], after: readonly SqlColumn[]): DiffOp[] {
  const beforeMap = new Map(before.map((column) => [column.name.toLowerCase(), column]));
  const afterMap = new Map(after.map((column) => [column.name.toLowerCase(), column]));
  const removed = before.filter((column) => !afterMap.has(column.name.toLowerCase()));
  const added = after.filter((column) => !beforeMap.has(column.name.toLowerCase()));
  const ops: DiffOp[] = [];
  if (removed.length === 1 && added.length === 1 && removed[0] && added[0]) {
    ops.push(
      makeOp("rename_column", true, `rename ${table}.${removed[0].name} to ${added[0].name}`, {
        table,
        from: removed[0].name,
        to: added[0].name,
      }),
    );
    ops.push(...columnTypeOps(table, removed[0], added[0]));
  } else {
    for (const column of removed) {
      ops.push(makeOp("drop_column", true, `drop column ${table}.${column.name}`, { table, column: column.name }));
    }
    for (const column of added) ops.push(addedColumn(table, column));
  }
  for (const column of after) {
    const prior = beforeMap.get(column.name.toLowerCase());
    if (!prior) continue;
    ops.push(...columnTypeOps(table, prior, column));
    if (prior.nullable && !column.nullable && !column.hasDefault) {
      ops.push(
        makeOp("add_required", true, `make ${table}.${column.name} required`, {
          table,
          column: column.name,
        }),
      );
    } else if (prior.nullable && !column.nullable) {
      ops.push(
        makeOp("tighten_constraint", true, `tighten nullability of ${table}.${column.name}`, {
          table,
          column: column.name,
        }),
      );
    } else if (!prior.nullable && column.nullable) {
      ops.push(
        makeOp("loosen_constraint", false, `allow null ${table}.${column.name}`, {
          table,
          column: column.name,
        }),
      );
    }
    if (prior.check !== column.check) {
      if (column.check.length > 0) {
        ops.push(
          makeOp("tighten_constraint", true, `tighten check on ${table}.${column.name}`, {
            table,
            column: column.name,
            from: prior.check,
            to: column.check,
          }),
        );
      } else {
        ops.push(
          makeOp("loosen_constraint", false, `drop check on ${table}.${column.name}`, {
            table,
            column: column.name,
          }),
        );
      }
    }
  }
  return ops;
}

function columnTypeOps(table: string, before: SqlColumn, after: SqlColumn): DiffOp[] {
  const relation = compareTypes(before.type, after.type);
  if (relation === "same") return [];
  const payload = { table, column: after.name, from: before.type, to: after.type };
  if (relation === "narrow") {
    return [makeOp("narrow_type", true, `narrow ${table}.${after.name} from ${before.type} to ${after.type}`, payload)];
  }
  if (relation === "widen") {
    return [makeOp("loosen_constraint", false, `widen ${table}.${after.name} from ${before.type} to ${after.type}`, payload)];
  }
  return [makeOp("type_change", true, `change ${table}.${before.name} from ${before.type} to ${after.type}`, payload)];
}

function addedColumn(table: string, column: SqlColumn): DiffOp {
  const payload = {
    table,
    column: column.name,
    type: column.type,
    nullable: column.nullable ? "true" : "false",
    default: column.defaultValue,
  };
  if (!column.nullable && !column.hasDefault) {
    return makeOp("add_required", true, `add required column ${table}.${column.name}`, payload);
  }
  if (column.hasDefault) {
    return makeOp("add_defaulted_column", false, `add defaulted column ${table}.${column.name}`, payload);
  }
  return makeOp("add_nullable_column", false, `add nullable column ${table}.${column.name}`, payload);
}

function applyStatement(catalog: Map<string, SqlTable>, statement: string): void {
  const create = /^create\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z_][\w]*)\s*\(([\s\S]*)\)$/i.exec(statement);
  if (create?.[1] && create[2] !== undefined) {
    const name = create[1];
    const columns = parseColumns(create[2]);
    catalog.set(name.toLowerCase(), { name, columns, ddl: `CREATE TABLE ${name} (${create[2].trim()})` });
    return;
  }
  const add = /^alter\s+table\s+([A-Za-z_][\w]*)\s+add\s+column\s+(.+)$/i.exec(statement);
  if (add?.[1] && add[2]) {
    const table = catalog.get(add[1].toLowerCase());
    const column = parseColumn(add[2]);
    if (table && column) {
      catalog.set(table.name.toLowerCase(), { ...table, columns: [...table.columns, column] });
    }
    return;
  }
  const dropColumn = /^alter\s+table\s+([A-Za-z_][\w]*)\s+drop\s+column\s+([A-Za-z_][\w]*)$/i.exec(statement);
  if (dropColumn?.[1] && dropColumn[2]) {
    const table = catalog.get(dropColumn[1].toLowerCase());
    if (!table) return;
    catalog.set(table.name.toLowerCase(), {
      ...table,
      columns: table.columns.filter((column) => column.name.toLowerCase() !== dropColumn[2]?.toLowerCase()),
    });
    return;
  }
  const renameColumn = /^alter\s+table\s+([A-Za-z_][\w]*)\s+rename\s+column\s+([A-Za-z_][\w]*)\s+to\s+([A-Za-z_][\w]*)$/i.exec(
    statement,
  );
  if (renameColumn?.[1] && renameColumn[2] && renameColumn[3]) {
    const table = catalog.get(renameColumn[1].toLowerCase());
    if (!table) return;
    catalog.set(table.name.toLowerCase(), {
      ...table,
      columns: table.columns.map((column) =>
        column.name.toLowerCase() === renameColumn[2]?.toLowerCase() ? { ...column, name: renameColumn[3] ?? column.name } : column,
      ),
    });
    return;
  }
  const renameTable = /^alter\s+table\s+([A-Za-z_][\w]*)\s+rename\s+to\s+([A-Za-z_][\w]*)$/i.exec(statement);
  if (renameTable?.[1] && renameTable[2]) {
    const table = catalog.get(renameTable[1].toLowerCase());
    if (!table) return;
    catalog.delete(renameTable[1].toLowerCase());
    catalog.set(renameTable[2].toLowerCase(), { ...table, name: renameTable[2] });
    return;
  }
  const dropTable = /^drop\s+table\s+(?:if\s+exists\s+)?([A-Za-z_][\w]*)$/i.exec(statement);
  if (dropTable?.[1]) catalog.delete(dropTable[1].toLowerCase());
}

function parseColumns(body: string): SqlColumn[] {
  const columns: SqlColumn[] = [];
  for (const chunk of splitComma(body)) {
    if (/^(constraint|primary\s+key|unique|check|foreign\s+key)\b/i.test(chunk.trim())) continue;
    const column = parseColumn(chunk);
    if (column) columns.push(column);
  }
  return columns;
}

function parseColumn(chunk: string): SqlColumn | null {
  const text = chunk.trim().replace(/\s+/g, " ");
  const name = /^([A-Za-z_][\w]*)\s+([\s\S]+)$/.exec(text);
  if (!name?.[1] || !name[2]) return null;
  const rest = name[2];
  const check = /\bcheck\s*(\([^)]*\))/i.exec(rest)?.[1] ?? "";
  const type = rest
    .replace(/\bprimary\s+key\b/gi, " ")
    .replace(/\bnot\s+null\b/gi, " ")
    .replace(/\bnull\b/gi, " ")
    .replace(/\bdefault\b[\s\S]*$/i, " ")
    .replace(/\bcheck\b[\s\S]*$/i, " ")
    .replace(/\breferences\b[\s\S]*$/i, " ")
    .replace(/\bunique\b/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
  const notNull = /\bnot\s+null\b/i.test(rest) || /\bprimary\s+key\b/i.test(rest);
  const explicitNull = /\bnull\b/i.test(rest) && !notNull;
  const defaultMatch = /\bdefault\s+(.+?)(?:\s+check\b|\s+references\b|$)/i.exec(rest);
  const defaultValue = defaultMatch?.[1]?.trim() ?? "";
  const hasDefault = defaultValue.length > 0 && defaultValue.toLowerCase() !== "null";
  return {
    name: name[1],
    type: type.length > 0 ? type : "TEXT",
    nullable: explicitNull || !notNull,
    hasDefault,
    defaultValue: hasDefault ? defaultValue : "",
    check,
  };
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) {
      const statement = sql.slice(start, index).trim();
      if (statement.length > 0) statements.push(statement.replace(/\s+/g, " "));
      start = index + 1;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail.length > 0) statements.push(tail.replace(/\s+/g, " "));
  return statements;
}

function splitComma(body: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function cloneTable(table: SqlTable): SqlTable {
  return { name: table.name, ddl: table.ddl, columns: table.columns.map((column) => ({ ...column })) };
}
