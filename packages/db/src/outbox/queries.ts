import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CanonicalOutboxQueries {
  readonly register_delivery: string;
  readonly prune_outbox: string;
  readonly outbox_without_deliveries: string;
}

let cachedRoot: string | undefined;
let cachedQueries: CanonicalOutboxQueries | undefined;

function walkToSchema(start: string): string | undefined {
  let dir = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      existsSync(path.join(dir, "schema", "queries.sql")) &&
      existsSync(path.join(dir, "schema", "state.sql"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/** Walk from this module, then cwd, to the checkout that contains schema/queries.sql. */
export function repositoryRoot(moduleUrl: string = import.meta.url): string {
  if (cachedRoot) return cachedRoot;
  const found =
    walkToSchema(path.dirname(fileURLToPath(moduleUrl))) ?? walkToSchema(process.cwd());
  if (!found) throw new Error("schema/queries.sql was not found from the outbox package");
  cachedRoot = found;
  return found;
}

/**
 * Same named-query extraction as schema/schema-test.js: the statement body
 * under `-- name:`, comments removed, trailing semicolon removed.
 */
export function parseNamedQueries(sql: string): Record<string, string> {
  const normalized = sql.replace(/\r\n/g, "\n");
  const queries: Record<string, string> = {};
  for (const block of normalized.split(/^-- name: /m).slice(1)) {
    const [name, ...rest] = block.split("\n");
    if (!name) continue;
    queries[name.trim()] = rest
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
  }
  return queries;
}

export function canonicalOutboxQueries(): CanonicalOutboxQueries {
  if (cachedQueries) return cachedQueries;
  const sql = readFileSync(path.join(repositoryRoot(), "schema", "queries.sql"), "utf8");
  const parsed = parseNamedQueries(sql);
  const registerDelivery = parsed.register_delivery;
  const pruneOutbox = parsed.prune_outbox;
  const withoutDeliveries = parsed.outbox_without_deliveries;
  if (!registerDelivery || !pruneOutbox || !withoutDeliveries) {
    throw new Error("schema/queries.sql is missing outbox statements");
  }
  cachedQueries = {
    register_delivery: registerDelivery,
    prune_outbox: pruneOutbox,
    outbox_without_deliveries: withoutDeliveries,
  };
  return cachedQueries;
}

export function readStateSchemaSql(): string {
  return readFileSync(path.join(repositoryRoot(), "schema", "state.sql"), "utf8");
}
