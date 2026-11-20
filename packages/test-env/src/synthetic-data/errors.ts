export class SchemaCycleDiagnostic extends Error {
  readonly code = "schema_cycle" as const;
  readonly cycle: readonly string[];

  constructor(cycle: readonly string[]) {
    super(`Schema cycle has zero nullable edges: ${cycle.join(" -> ")}`);
    this.name = "SchemaCycleDiagnostic";
    this.cycle = cycle;
  }
}

export class SchemaMetadataError extends Error {
  readonly code = "schema_metadata" as const;

  constructor(message: string) {
    super(message);
    this.name = "SchemaMetadataError";
  }
}

export class RecipeValidationError extends Error {
  readonly code = "recipe_validation" as const;

  constructor(message: string) {
    super(message);
    this.name = "RecipeValidationError";
  }
}

export class UniqueDomainExhaustedError extends Error {
  readonly code = "unique_domain_exhausted" as const;
  readonly table: string;
  readonly columns: readonly string[];

  constructor(table: string, columns: readonly string[]) {
    super(
      `Unique domain exhausted on ${table} (${columns.join(", ")}); refusing to bulk-load colliding values`,
    );
    this.name = "UniqueDomainExhaustedError";
    this.table = table;
    this.columns = columns;
  }
}

export class ConstraintViolationError extends Error {
  readonly code = "constraint_violation" as const;
  readonly table: string;
  readonly column: string;

  constructor(table: string, column: string, detail: string) {
    super(`Generated value violates ${table}.${column}: ${detail}`);
    this.name = "ConstraintViolationError";
    this.table = table;
    this.column = column;
  }
}

export class ProductionDataLeakError extends Error {
  readonly code = "production_data_leak" as const;
  readonly value: string;

  constructor(value: string) {
    super(`Refusing non-synthetic email domain in value "${value}"`);
    this.name = "ProductionDataLeakError";
    this.value = value;
  }
}

export class ForeignKeyViolationError extends Error {
  readonly code = "foreign_key_violation" as const;
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`Foreign key violations: ${violations.join("; ")}`);
    this.name = "ForeignKeyViolationError";
    this.violations = violations;
  }
}
