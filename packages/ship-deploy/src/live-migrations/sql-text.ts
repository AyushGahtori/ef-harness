const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ASSIGN_EXPRESSION =
  /^[A-Za-z_][A-Za-z0-9_]*(\s*[-+*/]\s*(?:\d+|[A-Za-z_][A-Za-z0-9_]*))*$/;

export function quoteIdent(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

export function assertAssignExpression(expression: string): string {
  const trimmed = expression.trim();
  if (!ASSIGN_EXPRESSION.test(trimmed)) {
    throw new Error(`unsafe backfill expression: ${expression}`);
  }
  return trimmed;
}

export function assertBatchSize(batchSize: number): number {
  if (!Number.isInteger(batchSize) || batchSize < 500 || batchSize > 1000) {
    throw new Error("batchSize must be an integer between 500 and 1000");
  }
  return batchSize;
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let lineComment = false;
  let blockComment = false;
  let trigger = false;
  let beginDepth = 0;

  const push = (): void => {
    const statement = current.trim();
    current = "";
    trigger = false;
    beginDepth = 0;
    if (statement) statements.push(statement);
  };

  for (let index = 0; index < sql.length; index += 1) {
    const ch = sql[index] ?? "";
    const next = sql[index + 1] ?? "";

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }

    if (!trigger && /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\b/i.test(current + ch)) {
      trigger = true;
    }
    if (trigger && /(?:^|[^A-Za-z0-9_])BEGIN$/i.test(current + ch)) {
      beginDepth += 1;
    }
    if (trigger && beginDepth > 0 && /(?:^|[^A-Za-z0-9_])END$/i.test(current + ch)) {
      beginDepth -= 1;
    }

    if (ch === ";" && beginDepth === 0) {
      push();
      continue;
    }
    current += ch;
  }
  push();
  return statements;
}

export function normalizeWhitespace(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

export function unquoteIdent(token: string): string {
  const trimmed = token.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll('""', '"');
  }
  return trimmed;
}

export function readIdent(source: string): { name: string; rest: string } | null {
  const match = /^\s*("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)([\s\S]*)$/.exec(source);
  if (!match) return null;
  const raw = match[1];
  const rest = match[2];
  if (!raw || rest === undefined) return null;
  return { name: unquoteIdent(raw), rest };
}

export function isConstantDefault(clause: string): boolean {
  return /\bDEFAULT\s+(?:-?\d+(?:\.\d+)?|NULL|TRUE|FALSE|'(?:[^']|'')*')(?!\w)/i.test(clause);
}

export function hasNotNull(clause: string): boolean {
  return /\bNOT\s+NULL\b/i.test(clause);
}
