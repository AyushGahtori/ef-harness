import type { Faker } from "@faker-js/faker";
import { fitString, measureText } from "./bounds.js";
import { computeTableChecksums } from "./checksum.js";
import { valueToken } from "./checksum.js";
import { assertSyntheticValue } from "./domains.js";
import { mulberry32, paretoInt, pickZipf, zipfCdf } from "./distribute.js";
import {
  ConstraintViolationError,
  ForeignKeyViolationError,
  SchemaMetadataError,
  UniqueDomainExhaustedError,
} from "./errors.js";
import { createSeededFaker } from "./faker-factory.js";
import { parseRecipe } from "./recipe.js";
import { normalizeSchema, type NormalizedColumn, type NormalizedTable } from "./schema.js";
import { emitBulkSql } from "./sql.js";
import { planInsertion, type FkEdge, type InsertionPlan } from "./topology.js";
import {
  BOUNDARY_ROW_COUNT,
  DST_FALL_INSTANTS,
  DST_SPRING_INSTANTS,
  SYNTHETIC_REFERENCE_INSTANT,
  type BoundaryCoverage,
  type DataValue,
  type DatasetPurpose,
  type GeneratedDataset,
  type GeneratedTable,
  type InsertBatch,
  type LoadPlan,
  type PredecessorFixture,
  type RowUpdate,
  type SchemaMetadata,
  type SeedProfile,
  type SeedRecipe,
} from "./types.js";
import { sha256Hex } from "./hash.js";

const ROLES = [
  "normal",
  "max_length",
  "unicode",
  "rtl_arabic",
  "rtl_hebrew",
  "nullable_soft",
  "cutoff_before",
  "cutoff_at",
  "cutoff_after",
  "dst_spring_before",
  "dst_spring_at",
  "dst_spring_after",
  "dst_fall_before",
  "dst_fall_at",
  "dst_fall_after",
  "duplicate",
] as const;

type RowRole = (typeof ROLES)[number] | "bulk";

interface DeferredCell {
  readonly table: string;
  readonly rowIndex: number;
  readonly column: string;
}

interface BuiltTable {
  readonly table: NormalizedTable;
  readonly rows: Record<string, DataValue>[];
  pass1: Record<string, DataValue>[];
}

export class SyntheticDataGenerator {
  generateDataset(schema: SchemaMetadata, recipeInput: unknown): GeneratedDataset {
    const recipe = parseRecipe(recipeInput);
    const purpose: DatasetPurpose = recipe.profile === "performance" ? "performance" : "functional";
    return this.generateFromRecipe(schema, recipe, purpose);
  }

  generateMigrationPredecessorFixture(
    schema: SchemaMetadata,
    recipeInput: unknown = {},
    commit?: string,
  ): PredecessorFixture {
    const recipe = { ...parseRecipe(recipeInput), profile: "functional" as const };
    const dataset = this.generateFromRecipe(schema, recipe, "migration-predecessor");
    return {
      commit: commit ?? null,
      purpose: "migration-predecessor",
      dataset,
      notes: [
        "nullable columns include nulls",
        "unicode, emoji, and maximum-length strings",
        "duplicate values where no unique constraint forbids them",
        "boundary timestamps around the cutoff and DST transitions",
        "orphan-looking rows with a null nullable foreign key",
        "soft-deleted parents that still have children",
      ],
    };
  }

  private generateFromRecipe(
    schemaInput: SchemaMetadata,
    recipe: SeedRecipe,
    purpose: DatasetPurpose,
  ): GeneratedDataset {
    const schema = normalizeSchema(schemaInput, recipe);
    const plan = planInsertion(schemaInput);
    const faker = createSeededFaker(recipe.seed, recipe.locale);
    const rng = mulberry32(recipe.seed >>> 0);
    const kinds = tableKinds(plan);
    const finals = new Map<string, Record<string, DataValue>[]>();
    const deferred: DeferredCell[] = [];
    const built: BuiltTable[] = [];

    for (const tableName of plan.order) {
      const table = schema.tableByName.get(tableName);
      if (!table) throw new SchemaMetadataError(`Missing normalized table ${tableName}`);
      const count = rowCountFor(table, kinds.get(tableName) ?? "plain", recipe);
      const keys = Array.from({ length: count }, (_, index) => primaryKey(table, recipe.seed, index));
      const rows: Record<string, DataValue>[] = [];
      const tracker = new UniqueTracker();
      const selfEdges = plan.selfEdges.filter((edge) => edge.fromTable === table.name);
      const deferredColumns = new Set(
        plan.deferredEdges.filter((edge) => edge.fromTable === table.name).map((edge) => edge.fromColumn),
      );

      for (let index = 0; index < count; index += 1) {
        const role = roleFor(index, count);
        const row: Record<string, DataValue> = { ...(keys[index] ?? {}) };
        for (const column of table.columns) {
          if (table.primaryKey.includes(column.name)) continue;
          if (deferredColumns.has(column.name)) {
            row[column.name] = null;
            continue;
          }
          const value = cellValue(
            table,
            column,
            role,
            index,
            count,
            keys,
            recipe,
            faker,
            rng,
            finals,
            selfEdges,
            plan,
          );
          row[column.name] = value.value;
          if (value.defer) {
            deferred.push({ table: table.name, rowIndex: index, column: column.name });
          }
        }
        if (role === "duplicate" && index > 0) copyDuplicates(table, rows[0], row);
        commitUnique(table, row, index, tracker);
        rows.push(row);
      }

      finals.set(table.name, rows);
      built.push({ table, rows, pass1: [] });
    }

    fillDeferredEdges(plan, built, finals, recipe, rng, deferred);
    for (const entry of built) {
      entry.pass1 = entry.rows.map((row) => ({ ...row }));
      for (const cell of deferred) {
        if (cell.table !== entry.table.name) continue;
        const target = entry.pass1[cell.rowIndex];
        if (target) target[cell.column] = null;
      }
    }

    appendBrownfield(schema.tableByName, recipe, built);
    assertIntegrity(schema.tables, finals);
    for (const [tableName, rows] of finals) {
      rows.forEach((row, index) => {
        for (const [column, value] of Object.entries(row)) {
          assertSyntheticValue(value ?? null, `${tableName}[${index}].${column}`);
        }
      });
    }

    const tables = built.map<GeneratedTable>((entry) => ({
      name: entry.table.name,
      columns: entry.table.columns.map((column) => column.name),
      primaryKey: entry.table.primaryKey,
      rows: entry.rows,
    }));
    const load = toLoadPlan(built, deferred);
    const coverage = collectCoverage(schema.tables, tables, recipe, plan);
    const datasetWithoutChecksums: GeneratedDataset = {
      seed: recipe.seed,
      profile: recipe.profile,
      locale: recipe.locale,
      purpose,
      tables,
      load,
      bulk: emitBulkSql(load),
      checksums: [],
      coverage,
      deferredUpdates: load.updates.length,
    };
    return {
      ...datasetWithoutChecksums,
      checksums: computeTableChecksums(datasetWithoutChecksums),
    };
  }
}

function rowCountFor(
  table: NormalizedTable,
  kind: "parent" | "fact" | "plain",
  recipe: SeedRecipe,
): number {
  if (recipe.singletonTables.includes(table.name) || table.maxRows === 1) return 1;
  const functional = Math.max(recipe.functionalRowCount, BOUNDARY_ROW_COUNT);
  const performance =
    kind === "parent"
      ? Math.min(1000, Math.max(32, Math.floor(recipe.performanceRowCount / 10)))
      : recipe.performanceRowCount;
  let count = recipe.profile === "performance" ? performance : functional;
  if (table.maxRows !== undefined) count = Math.min(count, table.maxRows);
  return Math.max(1, count);
}

function tableKinds(plan: InsertionPlan): Map<string, "parent" | "fact" | "plain"> {
  const referenced = new Set<string>();
  const outgoing = new Set<string>();
  for (const edge of plan.edges) {
    if (edge.self) continue;
    referenced.add(edge.toTable);
    outgoing.add(edge.fromTable);
  }
  const kinds = new Map<string, "parent" | "fact" | "plain">();
  const names = new Set<string>([...referenced, ...outgoing, ...plan.order]);
  for (const name of names) {
    if (referenced.has(name)) kinds.set(name, "parent");
    else if (outgoing.has(name)) kinds.set(name, "fact");
    else kinds.set(name, "plain");
  }
  return kinds;
}

function roleFor(index: number, count: number): RowRole {
  if (count === 1) return "normal";
  return ROLES[index] ?? "bulk";
}

function primaryKey(
  table: NormalizedTable,
  seed: number,
  index: number,
): Record<string, DataValue> {
  const record: Record<string, DataValue> = {};
  for (const name of table.primaryKey) {
    const column = requireColumn(table, name);
    record[name] = keyValue(column, table.name, seed, index);
  }
  return record;
}

function keyValue(
  column: NormalizedColumn,
  table: string,
  seed: number,
  index: number,
): DataValue {
  if (column.family === "int" || column.family === "real") {
    const start = column.min ?? 1;
    const value = start + index;
    if (column.max !== undefined && value > column.max) {
      throw new UniqueDomainExhaustedError(table, [column.name]);
    }
    return value;
  }
  if (column.family === "bool") return index === 0;
  const hex = sha256Hex(`${table}:${column.name}:${seed}:${index}`);
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return fitString(uuid, column.maxLength, column.lengthUnit, false);
}

function cellValue(
  table: NormalizedTable,
  column: NormalizedColumn,
  role: RowRole,
  index: number,
  count: number,
  keys: readonly Record<string, DataValue>[],
  recipe: SeedRecipe,
  faker: Faker,
  rng: () => number,
  finals: ReadonlyMap<string, readonly Record<string, DataValue>[]>,
  selfEdges: readonly FkEdge[],
  plan: InsertionPlan,
): { value: DataValue; defer: boolean } {
  if (column.softDelete) return { value: softDeleteValue(column, role, index, recipe), defer: false };
  if (role === "nullable_soft" && column.nullable && !column.primaryKey) {
    return { value: null, defer: false };
  }
  const self = selfEdges.find((edge) => edge.fromColumn === column.name);
  if (self) {
    return selfReference(index, count, keys, self);
  }
  if (column.references && column.references.table !== table.name) {
    const parents = finals.get(column.references.table) ?? [];
    const parentKeys = parents.map((row) => row[column.references?.column ?? ""] ?? null);
    const softParent = softDeletedKey(plan, column.references.table, finals);
    return {
      value: assignParent(
        index,
        role,
        parentKeys,
        softParent,
        column.nullable,
        recipe.profile,
        rng,
        null,
      ),
      defer: false,
    };
  }
  if (column.family === "bool") return { value: index % 2 === 0, defer: false };
  if (column.family === "timestamp" || column.hint === "timestamp_utc") {
    const instant = timestampFor(role, index, recipe);
    if (column.family === "int" || column.family === "real") {
      return { value: Date.parse(instant), defer: false };
    }
    return { value: fitString(instant, column.maxLength, column.lengthUnit, false), defer: false };
  }
  if (column.family === "int" || column.family === "real") {
    return { value: numberFor(column, role, index, recipe, rng), defer: false };
  }
  if (column.family === "blob") {
    return {
      value: fitString(sha256Hex(`${table.name}:${column.name}:${index}`), column.maxLength, column.lengthUnit, false),
      defer: false,
    };
  }
  return { value: textFor(table.name, column, role, index, recipe, faker), defer: false };
}

function selfReference(
  index: number,
  count: number,
  keys: readonly Record<string, DataValue>[],
  edge: FkEdge,
): { value: DataValue; defer: boolean } {
  const values = keys.map((key) => key[edge.toColumn] ?? null);
  const root = values[0] ?? null;
  if (count === 1 || index === 0) return { value: null, defer: false };
  if (count >= 3 && index === 1) return { value: values[count - 1] ?? null, defer: true };
  if (count >= 3 && index === count - 1) return { value: values[1] ?? root, defer: false };
  return { value: root, defer: false };
}

function fillDeferredEdges(
  plan: InsertionPlan,
  built: readonly BuiltTable[],
  finals: ReadonlyMap<string, readonly Record<string, DataValue>[]>,
  recipe: SeedRecipe,
  rng: () => number,
  deferred: DeferredCell[],
): void {
  for (const edge of plan.deferredEdges) {
    const entry = built.find((item) => item.table.name === edge.fromTable);
    if (!entry) continue;
    const parents = (finals.get(edge.toTable) ?? []).map(
      (row) => row[edge.toColumn] ?? null,
    );
    const softParent = softDeletedKey(plan, edge.toTable, finals);
    const column = entry.table.columns.find((item) => item.name === edge.fromColumn);
    const pool = parentPool(parents);
    const cdf = recipe.profile === "performance" ? zipfCdf(pool.length) : null;
    entry.rows.forEach((row, index) => {
      const role = roleFor(index, entry.rows.length);
      const value = assignParent(
        index,
        role,
        parents,
        softParent,
        column?.nullable ?? true,
        recipe.profile,
        rng,
        cdf,
      );
      row[edge.fromColumn] = value;
      if (value !== null) {
        deferred.push({ table: edge.fromTable, rowIndex: index, column: edge.fromColumn });
      }
    });
  }
}

function parentPool(parents: readonly DataValue[]): readonly DataValue[] {
  if (parents.length >= 3) return parents.slice(2);
  if (parents.length >= 2) return parents.slice(1);
  return parents;
}

function assignParent(
  index: number,
  role: RowRole,
  parents: readonly DataValue[],
  softParent: DataValue | null,
  nullable: boolean,
  profile: SeedProfile,
  rng: () => number,
  cdf: readonly number[] | null,
): DataValue | null {
  if (parents.length === 0) {
    if (nullable) return null;
    throw new ConstraintViolationError("fk", "parent", "referenced table has no rows");
  }
  if (role === "nullable_soft" && nullable) return null;
  if (parents.length === 1) return parents[0] ?? null;
  if (index === 0) return parents[1] ?? null;
  if (
    profile !== "performance" &&
    softParent !== null &&
    index === 2 &&
    softParent !== parents[0] &&
    softParent !== parents[1]
  ) {
    return softParent;
  }
  if (profile === "performance") {
    const pool = parentPool(parents);
    const usable = pool.length > 0 ? pool : parents;
    return usable[pickZipf(rng, cdf ?? zipfCdf(usable.length))] ?? null;
  }
  return parents[parents.length - 1] ?? null;
}

function softDeletedKey(
  plan: InsertionPlan,
  table: string,
  finals: ReadonlyMap<string, readonly Record<string, DataValue>[]>,
): DataValue | null {
  const rows = finals.get(table);
  if (!rows || rows.length < BOUNDARY_ROW_COUNT) return null;
  const row = rows[ROLES.indexOf("nullable_soft")];
  if (!row) return null;
  const edge = plan.edges.find((item) => item.toTable === table && !item.self);
  const column = edge?.toColumn ?? Object.keys(row)[0];
  if (!column) return null;
  return row[column] ?? null;
}

function softDeleteValue(
  column: NormalizedColumn,
  role: RowRole,
  index: number,
  recipe: SeedRecipe,
): DataValue {
  const deleted = role === "nullable_soft";
  if (column.family === "bool") return deleted;
  if (column.family === "int" || column.family === "real") return deleted ? 1 : 0;
  if (!deleted && column.nullable) return null;
  return timestampFor(deleted ? "cutoff_at" : "normal", index, recipe);
}

function textFor(
  table: string,
  column: NormalizedColumn,
  role: RowRole,
  index: number,
  recipe: SeedRecipe,
  faker: Faker,
): string {
  const max = column.maxLength;
  const unit = column.lengthUnit;
  if (column.allowedValues && column.allowedValues.length > 0) {
    return fitString(column.allowedValues[index % column.allowedValues.length] ?? "", max, unit, false);
  }
  if (column.hint === "email") {
    const domain = index % 2 === 0 ? "example.test" : "env.test";
    const suffix = `@${domain}`;
    if (role === "max_length" && max !== undefined) {
      const local = fitString(`user${index}`, Math.max(1, max - measureText(suffix, unit)), unit, true);
      return fitString(`${local}${suffix}`, max, unit, false);
    }
    return fitString(`user-${index}${suffix}`, max, unit, false);
  }
  if (column.hint === "slug") return fitString(`item-${index}`, max, unit, false);
  if (column.hint === "phone") {
    return fitString(`+1555010${String(index).padStart(4, "0")}`, max, unit, false);
  }
  if (column.hint === "url") return fitString(`https://example.test/items/${index}`, max, unit, false);
  const sampled = boundarySample(recipe, table, column.name, role);
  if (sampled !== undefined) return fitString(sampled, max, unit, role === "max_length");
  if (role === "max_length") return fitString("M", max, unit, true);
  if (role === "unicode") return fitString("Ümlaut 🍜", max, unit, false);
  if (role === "rtl_arabic") return fitString("مرحبا بالعالم", max, unit, false);
  if (role === "rtl_hebrew") return fitString("שלום עולם", max, unit, false);
  if (column.hint === "dish_name") {
    const vocab = recipe.vocabularies.dish_name ?? recipe.vocabularies[column.name] ?? [];
    if (vocab.length > 0 && !role.startsWith("rtl_")) {
      return fitString(vocab[index % vocab.length] ?? "Dish", max, unit, false);
    }
    if (role === "normal") return fitString(faker.food.dish().replaceAll("@", ""), max, unit, false);
    return fitString(`Dish ${index}`, max, unit, false);
  }
  if (column.hint === "name" && role === "normal") {
    return fitString(faker.person.fullName().replaceAll("@", ""), max, unit, false);
  }
  if (column.hint === "name") return fitString(`Name ${index}`, max, unit, false);
  return fitString(`${column.name}-${index}`, max, unit, false);
}

function boundarySample(
  recipe: SeedRecipe,
  table: string,
  column: string,
  role: RowRole,
): string | undefined {
  const kind =
    role === "max_length"
      ? "max_length"
      : role === "unicode"
        ? "unicode"
        : role === "rtl_arabic" || role === "rtl_hebrew"
          ? "rtl"
          : undefined;
  if (!kind) return undefined;
  for (const boundary of recipe.boundaries) {
    if (boundary.kind !== kind) continue;
    if (boundary.table !== undefined && boundary.table !== table) continue;
    if (boundary.column !== undefined && boundary.column !== column) continue;
    const sample = boundary.samples?.[role === "rtl_hebrew" ? 1 : 0] ?? boundary.samples?.[0];
    if (sample !== undefined) return sample;
  }
  return undefined;
}

function numberFor(
  column: NormalizedColumn,
  role: RowRole,
  index: number,
  recipe: SeedRecipe,
  rng: () => number,
): number {
  const min = column.min ?? 0;
  const max = column.max ?? (column.hint === "money_minor_units" ? 25000 : 1000);
  if (max < min) {
    throw new ConstraintViolationError(column.name, column.name, "minimum is greater than maximum");
  }
  if (role === "max_length" || role === "cutoff_at") return max;
  if (role === "nullable_soft" || role === "cutoff_before") return min;
  if (recipe.profile === "performance" && (column.hint === "money_minor_units" || column.family === "real")) {
    return paretoInt(rng, min, max);
  }
  const span = max - min + 1;
  return min + ((Math.abs(index * 17 + recipe.seed) % span) + span) % span;
}

function timestampFor(role: RowRole, index: number, recipe: SeedRecipe): string {
  const cutoff = Date.parse(recipe.cutoff);
  if (role === "cutoff_before") return new Date(cutoff - 1000).toISOString();
  if (role === "cutoff_at") return new Date(cutoff).toISOString();
  if (role === "cutoff_after") return new Date(cutoff + 1000).toISOString();
  if (role === "dst_spring_before") return DST_SPRING_INSTANTS[0];
  if (role === "dst_spring_at") return DST_SPRING_INSTANTS[1];
  if (role === "dst_spring_after") return DST_SPRING_INSTANTS[2];
  if (role === "dst_fall_before") return DST_FALL_INSTANTS[0];
  if (role === "dst_fall_at") return DST_FALL_INSTANTS[1];
  if (role === "dst_fall_after") return DST_FALL_INSTANTS[2];
  return new Date(Date.parse(SYNTHETIC_REFERENCE_INSTANT) + index * 1000).toISOString();
}

function copyDuplicates(
  table: NormalizedTable,
  source: Record<string, DataValue> | undefined,
  target: Record<string, DataValue>,
): void {
  if (!source) return;
  const protectedColumns = new Set<string>(table.primaryKey);
  for (const group of table.uniqueGroups) {
    for (const name of group) protectedColumns.add(name);
  }
  for (const column of table.columns) {
    if (protectedColumns.has(column.name) || column.references || column.primaryKey) continue;
    const value = source[column.name];
    if (value !== undefined) target[column.name] = value;
  }
}

function commitUnique(
  table: NormalizedTable,
  row: Record<string, DataValue>,
  index: number,
  tracker: UniqueTracker,
): void {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    assertRow(table, row);
    const collision = tracker.collision(table, row);
    if (!collision) {
      tracker.commit(table, row);
      return;
    }
    if (!nudge(table, row, collision, index, attempt)) {
      throw new UniqueDomainExhaustedError(table.name, collision);
    }
  }
  throw new UniqueDomainExhaustedError(table.name, table.primaryKey);
}

function nudge(
  table: NormalizedTable,
  row: Record<string, DataValue>,
  columns: readonly string[],
  index: number,
  attempt: number,
): boolean {
  for (const name of columns) {
    const column = table.columns.find((item) => item.name === name);
    if (!column || column.primaryKey) continue;
    if (column.family === "text" || column.family === "timestamp") {
      const next = fitString(
        `${String(row[name] ?? "v")}~${index.toString(36)}${attempt.toString(36)}`,
        column.maxLength,
        column.lengthUnit,
        false,
      );
      if (next !== row[name]) {
        row[name] = next;
        return true;
      }
    }
    if (column.family === "int" || column.family === "real") {
      const min = column.min ?? 0;
      const max = column.max ?? min + 1_000_000;
      const current = typeof row[name] === "number" ? row[name] : min;
      const next = current + attempt + 1;
      if (next <= max) {
        row[name] = next;
        return true;
      }
    }
  }
  return false;
}

function assertRow(table: NormalizedTable, row: Record<string, DataValue>): void {
  for (const column of table.columns) {
    const value = row[column.name] ?? null;
    if (value === null) {
      if (!column.nullable) {
        throw new ConstraintViolationError(table.name, column.name, "null is not allowed");
      }
      continue;
    }
    if (typeof value === "number" && (column.min !== undefined || column.max !== undefined)) {
      if (column.min !== undefined && value < column.min) {
        throw new ConstraintViolationError(table.name, column.name, `${value} < ${column.min}`);
      }
      if (column.max !== undefined && value > column.max) {
        throw new ConstraintViolationError(table.name, column.name, `${value} > ${column.max}`);
      }
    }
    if (typeof value === "string" && column.maxLength !== undefined) {
      const measured = measureText(value, column.lengthUnit);
      if (measured > column.maxLength) {
        throw new ConstraintViolationError(
          table.name,
          column.name,
          `length ${measured} exceeds ${column.maxLength} ${column.lengthUnit}`,
        );
      }
    }
    if (column.allowedValues && typeof value === "string" && !column.allowedValues.includes(value)) {
      throw new ConstraintViolationError(table.name, column.name, "value is outside the IN list");
    }
  }
}

class UniqueTracker {
  private readonly seen = new Map<string, Set<string>>();

  collision(table: NormalizedTable, row: Record<string, DataValue>): readonly string[] | null {
    for (const group of table.uniqueGroups) {
      const token = group.map((column) => valueToken(row[column] ?? null)).join("|");
      const bucket = this.seen.get(this.key(table.name, group));
      if (bucket?.has(token)) return group;
    }
    return null;
  }

  commit(table: NormalizedTable, row: Record<string, DataValue>): void {
    for (const group of table.uniqueGroups) {
      const key = this.key(table.name, group);
      const bucket = this.seen.get(key) ?? new Set<string>();
      bucket.add(group.map((column) => valueToken(row[column] ?? null)).join("|"));
      this.seen.set(key, bucket);
    }
  }

  private key(table: string, group: readonly string[]): string {
    return `${table}:${group.join("\u0000")}`;
  }
}

function appendBrownfield(
  tables: ReadonlyMap<string, NormalizedTable>,
  recipe: SeedRecipe,
  built: BuiltTable[],
): void {
  for (const [tableName, rows] of Object.entries(recipe.sanitizedBrownfield)) {
    const table = tables.get(tableName);
    const entry = built.find((item) => item.table.name === tableName);
    if (!table || !entry) {
      throw new SchemaMetadataError(`sanitizedBrownfield references unknown table ${tableName}`);
    }
    const tracker = new UniqueTracker();
    for (const existing of entry.rows) tracker.commit(table, { ...existing });
    for (const [index, raw] of rows.entries()) {
      const row: Record<string, DataValue> = {};
      for (const column of table.columns) row[column.name] = raw[column.name] ?? null;
      for (const [column, value] of Object.entries(row)) {
        assertSyntheticValue(value ?? null, `${tableName}.brownfield[${index}].${column}`);
      }
      commitUnique(table, row, entry.rows.length + index, tracker);
      entry.rows.push({ ...row });
      entry.pass1.push({ ...row });
    }
  }
}

function assertIntegrity(
  tables: readonly NormalizedTable[],
  finals: ReadonlyMap<string, readonly Record<string, DataValue>[]>,
): void {
  const violations: string[] = [];
  for (const table of tables) {
    for (const column of table.columns) {
      if (!column.references) continue;
      const parents = finals.get(column.references.table) ?? [];
      const allowed = new Set(parents.map((row) => valueToken(row[column.references?.column ?? ""] ?? null)));
      for (const row of finals.get(table.name) ?? []) {
        const value = row[column.name] ?? null;
        if (value === null) continue;
        if (!allowed.has(valueToken(value))) {
          violations.push(`${table.name}.${column.name}=${String(value)}`);
        }
      }
    }
  }
  if (violations.length > 0) throw new ForeignKeyViolationError(violations.slice(0, 8));
}

function toLoadPlan(built: readonly BuiltTable[], deferred: readonly DeferredCell[]): LoadPlan {
  const inserts: InsertBatch[] = built.map((entry) => ({
    table: entry.table.name,
    columns: entry.table.columns.map((column) => column.name),
    rows: entry.pass1,
  }));
  const updates: RowUpdate[] = [];
  for (const cell of deferred) {
    const entry = built.find((item) => item.table.name === cell.table);
    const row = entry?.rows[cell.rowIndex];
    if (!entry || !row) continue;
    const where: Record<string, DataValue> = {};
    for (const key of entry.table.primaryKey) where[key] = row[key] ?? null;
    updates.push({
      table: cell.table,
      set: { [cell.column]: row[cell.column] ?? null },
      where,
    });
  }
  return { inserts, updates };
}

function collectCoverage(
  tables: readonly NormalizedTable[],
  generated: readonly GeneratedTable[],
  recipe: SeedRecipe,
  plan: InsertionPlan,
): BoundaryCoverage {
  const strings: string[] = [];
  const numbers: number[] = [];
  let softDeleted = false;
  let nullFields = false;
  let duplicateValues = false;
  let maxLength = false;
  for (const table of generated) {
    const normalized = tables.find((item) => item.name === table.name);
    for (const row of table.rows) {
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === "string") strings.push(value);
        if (typeof value === "number") numbers.push(value);
        const column = normalized?.columns.find((item) => item.name === key);
        if (!column) continue;
        if (value === null && column.nullable) nullFields = true;
        if (column.softDelete && value !== null && value !== false && value !== 0) softDeleted = true;
        if (
          typeof value === "string" &&
          column.maxLength !== undefined &&
          measureText(value, column.lengthUnit) === column.maxLength
        ) {
          maxLength = true;
        }
      }
    }
    if (normalized) {
      for (const column of normalized.columns) {
        if (column.primaryKey || column.unique || column.references) continue;
        const seen = new Map<string, number>();
        for (const row of table.rows) {
          const value = row[column.name];
          if (value === null || value === undefined) continue;
          const token = valueToken(value);
          seen.set(token, (seen.get(token) ?? 0) + 1);
        }
        if ([...seen.values()].some((count) => count >= 2)) duplicateValues = true;
      }
    }
  }
  const cutoff = Date.parse(recipe.cutoff);
  const before = new Date(cutoff - 1000).toISOString();
  const at = new Date(cutoff).toISOString();
  const after = new Date(cutoff + 1000).toISOString();
  const cardinality = cardinalityCoverage(plan, generated);
  return {
    maxLength,
    unicode: strings.some((value) => value.includes("Ümlaut") || value.includes("Ü")),
    emoji: strings.some((value) => value.includes("🍜")),
    rtlArabic: strings.some((value) => /[\u0600-\u06FF]/.test(value)),
    rtlHebrew: strings.some((value) => /[\u0590-\u05FF]/.test(value)),
    cutoffBefore: strings.includes(before) || numbers.includes(Date.parse(before)),
    cutoffAt: strings.includes(at) || numbers.includes(Date.parse(at)),
    cutoffAfter: strings.includes(after) || numbers.includes(Date.parse(after)),
    dstSpring: DST_SPRING_INSTANTS.every(
      (instant) => strings.includes(instant) || numbers.includes(Date.parse(instant)),
    ),
    dstFall: DST_FALL_INSTANTS.every(
      (instant) => strings.includes(instant) || numbers.includes(Date.parse(instant)),
    ),
    zeroChildren: cardinality.zero,
    oneChild: cardinality.one,
    manyChildren: cardinality.many,
    softDeleted,
    nullFields,
    duplicateValues,
    orphanLooking: cardinality.orphan,
  };
}

function cardinalityCoverage(
  plan: InsertionPlan,
  generated: readonly GeneratedTable[],
): { zero: boolean; one: boolean; many: boolean; orphan: boolean } {
  let zero = false;
  let one = false;
  let many = false;
  let orphan = false;
  for (const edge of plan.edges) {
    const parents = generated.find((table) => table.name === edge.toTable)?.rows ?? [];
    const children = generated.find((table) => table.name === edge.fromTable)?.rows ?? [];
    const counts = new Map<string, number>();
    for (const parent of parents) counts.set(valueToken(parent[edge.toColumn] ?? null), 0);
    for (const child of children) {
      const value = child[edge.fromColumn];
      if (value === null || value === undefined) {
        orphan = true;
        continue;
      }
      const token = valueToken(value);
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    for (const count of counts.values()) {
      if (count === 0) zero = true;
      if (count === 1) one = true;
      if (count >= 3) many = true;
    }
  }
  return { zero, one, many, orphan };
}

function requireColumn(table: NormalizedTable, name: string): NormalizedColumn {
  const column = table.columns.find((item) => item.name === name);
  if (!column) throw new SchemaMetadataError(`${table.name}.${name} is not a column`);
  return column;
}
