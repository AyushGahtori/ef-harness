import { SchemaCycleDiagnostic, SchemaMetadataError } from "./errors.js";
import type { SchemaMetadata } from "./types.js";

export interface FkEdge {
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
  readonly nullable: boolean;
  readonly self: boolean;
}

export interface InsertionPlan {
  readonly order: readonly string[];
  readonly deferredEdges: readonly FkEdge[];
  readonly selfEdges: readonly FkEdge[];
  readonly edges: readonly FkEdge[];
}

export function planInsertion(schema: SchemaMetadata): InsertionPlan {
  const tables = schema.tables.map((table) => table.name);
  if (new Set(tables).size !== tables.length) {
    throw new SchemaMetadataError("Schema contains duplicate table names");
  }
  const known = new Set(tables);
  const edges = collectEdges(schema, known);
  for (const edge of edges) {
    if (edge.self && !edge.nullable) {
      throw new SchemaCycleDiagnostic([
        `${edge.fromTable}.${edge.fromColumn}`,
        `${edge.toTable}.${edge.toColumn}`,
      ]);
    }
  }

  let active = edges.filter((edge) => !edge.self);
  const deferred: FkEdge[] = [];
  for (;;) {
    const cycle = findCycle(tables, active);
    if (!cycle) break;
    const nullable = active
      .filter(
        (edge) =>
          edge.nullable && cycle.tables.has(edge.fromTable) && cycle.tables.has(edge.toTable),
      )
      .sort((left, right) => edgeKey(left).localeCompare(edgeKey(right)));
    const pick = nullable[0];
    if (!pick) {
      throw new SchemaCycleDiagnostic(cycle.path);
    }
    deferred.push(pick);
    active = active.filter((edge) => edge !== pick);
  }

  return {
    order: kahn(tables, active),
    deferredEdges: deferred,
    selfEdges: edges.filter((edge) => edge.self),
    edges,
  };
}

function collectEdges(schema: SchemaMetadata, known: ReadonlySet<string>): FkEdge[] {
  const edges: FkEdge[] = [];
  for (const table of schema.tables) {
    for (const column of table.columns) {
      const reference = column.references;
      if (!reference) continue;
      if (!known.has(reference.table)) {
        throw new SchemaMetadataError(
          `${table.name}.${column.name} references missing table ${reference.table}`,
        );
      }
      const nullable = column.primaryKey ? false : column.nullable !== false;
      edges.push({
        fromTable: table.name,
        fromColumn: column.name,
        toTable: reference.table,
        toColumn: reference.column,
        nullable,
        self: reference.table === table.name,
      });
    }
  }
  return edges;
}

function edgeKey(edge: FkEdge): string {
  return `${edge.fromTable}.${edge.fromColumn}->${edge.toTable}.${edge.toColumn}`;
}

function findCycle(
  tables: readonly string[],
  edges: readonly FkEdge[],
): { path: string[]; tables: Set<string> } | null {
  const adjacency = new Map<string, string[]>();
  for (const table of tables) adjacency.set(table, []);
  for (const edge of edges) {
    adjacency.get(edge.fromTable)?.push(edge.toTable);
  }
  for (const [table, next] of adjacency) {
    adjacency.set(table, [...new Set(next)].sort());
  }

  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  let found: string[] | null = null;

  const visit = (node: string): void => {
    if (found) return;
    color.set(node, 1);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const state = color.get(next) ?? 0;
      if (state === 1) {
        const start = stack.indexOf(next);
        found = stack.slice(start).concat(next);
        return;
      }
      if (state === 0) visit(next);
      if (found) return;
    }
    stack.pop();
    color.set(node, 2);
  };

  for (const table of [...tables].sort()) {
    if ((color.get(table) ?? 0) === 0) visit(table);
    if (found) break;
  }
  if (!found) return null;
  return { path: found, tables: new Set(found) };
}

function kahn(tables: readonly string[], edges: readonly FkEdge[]): string[] {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const table of tables) {
    indegree.set(table, 0);
    dependents.set(table, []);
  }
  for (const edge of edges) {
    indegree.set(edge.fromTable, (indegree.get(edge.fromTable) ?? 0) + 1);
    dependents.get(edge.toTable)?.push(edge.fromTable);
  }
  const ready = tables.filter((table) => (indegree.get(table) ?? 0) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const next = ready.shift();
    if (next === undefined) break;
    order.push(next);
    const children = [...(dependents.get(next) ?? [])].sort();
    for (const child of children) {
      const remaining = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, remaining);
      if (remaining === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }
  if (order.length !== tables.length) {
    const stuck = tables.filter((table) => !order.includes(table));
    throw new SchemaCycleDiagnostic(stuck);
  }
  return order;
}
