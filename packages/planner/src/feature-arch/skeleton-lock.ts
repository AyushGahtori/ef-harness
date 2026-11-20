import { issue } from "./issues.js";
import { LOCAL_PORTS, type ArchIssue, type CcrProposal, type ColumnSpec, type LockReport, type SchemaDelta, type SkeletonSnapshot } from "./types.js";

/** Local port of Task 083 `SkeletonLockEnforcer`. */
export class SkeletonLockEnforcer {
  static readonly source = LOCAL_PORTS.skeletonLockEnforcer;

  check(deltas: readonly SchemaDelta[], skeleton: SkeletonSnapshot): LockReport {
    const violations: ArchIssue[] = [];
    const ccrProposals: CcrProposal[] = [];
    const tables = new Map(skeleton.tables.map((table) => [table.name, table]));

    for (const delta of deltas) {
      switch (delta.op) {
        case "add_table":
          this.addTable(delta, tables, violations);
          break;
        case "add_column":
          this.addColumn(delta, tables, skeleton, violations, ccrProposals);
          break;
        case "drop_column":
          this.destructive(
            delta.table,
            delta.column,
            `drop_column ${delta.column}`,
            tables,
            skeleton,
            violations,
            ccrProposals,
          );
          break;
        case "rename_column":
          this.destructive(
            delta.table,
            delta.from,
            `rename_column ${delta.from} -> ${delta.to}`,
            tables,
            skeleton,
            violations,
            ccrProposals,
          );
          break;
        case "change_type":
          this.changeType(delta, tables, skeleton, violations, ccrProposals);
          break;
        case "drop_table":
          this.destructive(
            delta.table,
            delta.table,
            `drop_table ${delta.table}`,
            tables,
            skeleton,
            violations,
            ccrProposals,
          );
          break;
        default: {
          const unreachable: never = delta;
          return unreachable;
        }
      }
    }

    return { ok: violations.length === 0, violations, ccrProposals };
  }

  private addTable(
    delta: Extract<SchemaDelta, { op: "add_table" }>,
    tables: Map<string, SkeletonSnapshot["tables"][number]>,
    violations: ArchIssue[],
  ): void {
    if (!delta.table.trim() || delta.columns.length === 0) {
      violations.push(issue("invalid_schema_delta", "add_table requires a name and at least one column."));
      return;
    }
    if (delta.columns.some((column) => !column.name.trim() || !column.type.trim())) {
      violations.push(issue("invalid_schema_delta", `add_table ${delta.table} has a blank column.`));
      return;
    }
    if (tables.has(delta.table)) {
      violations.push(issue("table_exists", `Table ${delta.table} already exists on the skeleton.`));
    }
  }

  private addColumn(
    delta: Extract<SchemaDelta, { op: "add_column" }>,
    tables: Map<string, SkeletonSnapshot["tables"][number]>,
    skeleton: SkeletonSnapshot,
    violations: ArchIssue[],
    ccrProposals: CcrProposal[],
  ): void {
    const table = tables.get(delta.table);
    if (!table) {
      violations.push(issue("unknown_table", `Cannot add column ${delta.column.name} to unknown table ${delta.table}.`));
      return;
    }
    if (!delta.column.name.trim() || !delta.column.type.trim()) {
      violations.push(issue("invalid_schema_delta", `add_column on ${delta.table} has a blank column.`));
      return;
    }
    if (table.columns.some((column) => column.name === delta.column.name)) {
      violations.push(
        issue("column_exists", `Column ${delta.table}.${delta.column.name} already exists.`),
      );
      return;
    }
    const locked = skeleton.locked && table.locked;
    if (locked && delta.column.nullable !== true) {
      this.pushCcr(
        delta.table,
        delta.column.name,
        `add_column ${delta.column.name} ${delta.column.type} NOT NULL`,
        violations,
        ccrProposals,
      );
    }
  }

  private changeType(
    delta: Extract<SchemaDelta, { op: "change_type" }>,
    tables: Map<string, SkeletonSnapshot["tables"][number]>,
    skeleton: SkeletonSnapshot,
    violations: ArchIssue[],
    ccrProposals: CcrProposal[],
  ): void {
    const table = tables.get(delta.table);
    if (!table) {
      violations.push(issue("unknown_table", `Cannot change a column on unknown table ${delta.table}.`));
      return;
    }
    const column = table.columns.find((item) => item.name === delta.column);
    const from = column?.type ?? "unknown";
    if (!skeleton.locked || !table.locked) return;
    this.pushCcr(
      delta.table,
      delta.column,
      `change_type ${from} -> ${delta.toType}`,
      violations,
      ccrProposals,
    );
  }

  private destructive(
    tableName: string,
    columnName: string,
    mutation: string,
    tables: Map<string, SkeletonSnapshot["tables"][number]>,
    skeleton: SkeletonSnapshot,
    violations: ArchIssue[],
    ccrProposals: CcrProposal[],
  ): void {
    const table = tables.get(tableName);
    if (!table) {
      violations.push(issue("unknown_table", `Cannot apply ${mutation} to unknown table ${tableName}.`));
      return;
    }
    if (!skeleton.locked || !table.locked) return;
    this.pushCcr(tableName, columnName, mutation, violations, ccrProposals);
  }

  private pushCcr(
    tableName: string,
    columnName: string,
    mutation: string,
    violations: ArchIssue[],
    ccrProposals: CcrProposal[],
  ): void {
    const id = `CCR-${sanitize(tableName)}-${sanitize(columnName)}-${sanitize(mutation.split(" ")[0] ?? "change")}`;
    const proposal: CcrProposal = {
      id,
      class: "breaking",
      target: tableName === columnName ? tableName : `${tableName}.${columnName}`,
      mutation,
      reason: "Locked skeleton forbids this destructive change. Route it through a CCR.",
      routedTo: "task-112",
    };
    ccrProposals.push(proposal);
    violations.push(
      issue(
        "skeleton_lock",
        `${proposal.target} ${mutation} is blocked. Proposal ${proposal.id} is routed to task-112.`,
      ),
    );
  }
}

function sanitize(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "change";
}

export function isColumnSpec(value: unknown): value is ColumnSpec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const column = value as Record<string, unknown>;
  return typeof column.name === "string" && typeof column.type === "string" && typeof column.nullable === "boolean";
}
