import { RecipeValidationError } from "./errors.js";
import { hashCanonical, type Canonical } from "./hash.js";
import {
  DEFAULT_CUTOFF_INSTANT,
  type BoundaryKind,
  type DataRow,
  type DataValue,
  type SeedProfile,
  type SeedRecipe,
  type SpecBoundary,
} from "./types.js";

const BOUNDARY_KINDS = new Set<BoundaryKind>([
  "max_length",
  "unicode",
  "emoji",
  "rtl",
  "cutoff",
  "dst",
  "cardinality",
  "soft_delete",
  "nullable",
]);

const RECIPE_KEYS = new Set([
  "seed",
  "profile",
  "locale",
  "functionalRowCount",
  "performanceRowCount",
  "cutoff",
  "timezone",
  "vocabularies",
  "boundaries",
  "singletonTables",
  "columnHints",
  "sanitizedBrownfield",
]);

export const SeedRecipeSchema = {
  parse(input: unknown): SeedRecipe {
    return parseRecipe(input);
  },
  safeParse(
    input: unknown,
  ): { success: true; data: SeedRecipe } | { success: false; error: RecipeValidationError } {
    try {
      return { success: true, data: parseRecipe(input) };
    } catch (error) {
      if (error instanceof RecipeValidationError) return { success: false, error };
      return {
        success: false,
        error: new RecipeValidationError(error instanceof Error ? error.message : String(error)),
      };
    }
  },
};

export function hashSeedRecipe(recipe: SeedRecipe): string {
  return hashCanonical(recipeToCanonical(recipe));
}

export function parseRecipe(input: unknown): SeedRecipe {
  const source = input === undefined ? {} : input;
  if (!isRecord(source)) {
    throw new RecipeValidationError("Seed recipe must be an object");
  }
  for (const key of Object.keys(source)) {
    if (!RECIPE_KEYS.has(key)) {
      throw new RecipeValidationError(`Unknown seed recipe field "${key}"`);
    }
  }

  const seed = readSeed(source.seed);
  const profile = readProfile(source.profile);
  const locale = readLocale(source.locale);
  const functionalRowCount = readMinInt(source.functionalRowCount, 16, 3, "functionalRowCount");
  const performanceRowCount = readMinInt(
    source.performanceRowCount,
    10000,
    10000,
    "performanceRowCount",
  );
  const cutoff = readInstant(source.cutoff);
  const timezone = readOptionalString(source.timezone, "UTC", "timezone");
  const vocabularies = readVocabularies(source.vocabularies);
  const boundaries = readBoundaries(source.boundaries);
  const singletonTables = readStringList(source.singletonTables, "singletonTables");
  const columnHints = readStringMap(source.columnHints, "columnHints");
  const sanitizedBrownfield = readBrownfield(source.sanitizedBrownfield);

  return {
    seed,
    profile,
    locale,
    functionalRowCount,
    performanceRowCount,
    cutoff,
    timezone,
    vocabularies,
    boundaries,
    singletonTables,
    columnHints,
    sanitizedBrownfield,
  };
}

function recipeToCanonical(recipe: SeedRecipe): Canonical {
  const vocabularies: { [key: string]: Canonical } = {};
  for (const key of Object.keys(recipe.vocabularies).sort()) {
    vocabularies[key] = (recipe.vocabularies[key] ?? []).map((item) => item.normalize("NFC"));
  }
  const hints: { [key: string]: Canonical } = {};
  for (const key of Object.keys(recipe.columnHints).sort()) {
    hints[key] = (recipe.columnHints[key] ?? "").normalize("NFC");
  }
  const brownfield: { [key: string]: Canonical } = {};
  for (const key of Object.keys(recipe.sanitizedBrownfield).sort()) {
    brownfield[key] = (recipe.sanitizedBrownfield[key] ?? []).map((row) => {
      const record: { [column: string]: Canonical } = {};
      for (const column of Object.keys(row).sort()) {
        record[column] = (row[column] ?? null) as Canonical;
      }
      return record;
    });
  }
  return {
    seed: recipe.seed,
    profile: recipe.profile,
    locale: recipe.locale,
    functionalRowCount: recipe.functionalRowCount,
    performanceRowCount: recipe.performanceRowCount,
    cutoff: recipe.cutoff,
    timezone: recipe.timezone,
    vocabularies,
    boundaries: recipe.boundaries.map((boundary) => ({
      kind: boundary.kind,
      ...(boundary.table !== undefined ? { table: boundary.table } : {}),
      ...(boundary.column !== undefined ? { column: boundary.column } : {}),
      ...(boundary.cutoff !== undefined ? { cutoff: boundary.cutoff } : {}),
      ...(boundary.timezone !== undefined ? { timezone: boundary.timezone } : {}),
      ...(boundary.maxLength !== undefined ? { maxLength: boundary.maxLength } : {}),
      ...(boundary.samples !== undefined ? { samples: [...boundary.samples] } : {}),
    })),
    singletonTables: [...recipe.singletonTables],
    columnHints: hints,
    sanitizedBrownfield: brownfield,
  };
}

function readSeed(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RecipeValidationError("seed must be a safe integer");
  }
  return value;
}

function readProfile(value: unknown): SeedProfile {
  if (value === undefined) return "functional";
  if (value === "functional" || value === "performance") return value;
  throw new RecipeValidationError('profile must be "functional" or "performance"');
}

function readLocale(value: unknown): string {
  if (value === undefined) return "en";
  if (typeof value !== "string" || value.trim() === "") {
    throw new RecipeValidationError("locale must be a non-empty string");
  }
  return value.trim().normalize("NFC");
}

function readMinInt(value: unknown, fallback: number, min: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw new RecipeValidationError(`${label} must be an integer >= ${min}`);
  }
  return value;
}

function readInstant(value: unknown): string {
  if (value === undefined) return DEFAULT_CUTOFF_INSTANT;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new RecipeValidationError("cutoff must be a parseable UTC timestamp");
  }
  return new Date(value).toISOString();
}

function readOptionalString(value: unknown, fallback: string, label: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new RecipeValidationError(`${label} must be a non-empty string`);
  }
  return value.trim().normalize("NFC");
}

function readVocabularies(value: unknown): Readonly<Record<string, readonly string[]>> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new RecipeValidationError("vocabularies must be an object");
  const vocabularies: Record<string, readonly string[]> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!Array.isArray(entry) || entry.some((item) => typeof item !== "string")) {
      throw new RecipeValidationError(`vocabulary "${key}" must be a string array`);
    }
    vocabularies[key.normalize("NFC")] = entry.map((item) => item.normalize("NFC"));
  }
  return vocabularies;
}

function readBoundaries(value: unknown): readonly SpecBoundary[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new RecipeValidationError("boundaries must be an array");
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new RecipeValidationError(`boundaries[${index}] must be an object`);
    }
    const kind = entry.kind;
    if (typeof kind !== "string" || !BOUNDARY_KINDS.has(kind as BoundaryKind)) {
      throw new RecipeValidationError(`boundaries[${index}].kind is not supported`);
    }
    const boundary: SpecBoundary = {
      kind: kind as BoundaryKind,
      ...(typeof entry.table === "string" ? { table: entry.table } : {}),
      ...(typeof entry.column === "string" ? { column: entry.column } : {}),
      ...(typeof entry.cutoff === "string" ? { cutoff: new Date(entry.cutoff).toISOString() } : {}),
      ...(typeof entry.timezone === "string" ? { timezone: entry.timezone } : {}),
      ...(typeof entry.maxLength === "number" ? { maxLength: entry.maxLength } : {}),
      ...(Array.isArray(entry.samples)
        ? { samples: entry.samples.filter((item): item is string => typeof item === "string") }
        : {}),
    };
    return boundary;
  });
}

function readStringList(value: unknown, label: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new RecipeValidationError(`${label} must be a string array`);
  }
  return value.map((item) => item.normalize("NFC"));
}

function readStringMap(value: unknown, label: string): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new RecipeValidationError(`${label} must be an object`);
  const map: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new RecipeValidationError(`${label}.${key} must be a string`);
    }
    map[key] = entry.normalize("NFC");
  }
  return map;
}

function readBrownfield(value: unknown): Readonly<Record<string, readonly DataRow[]>> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new RecipeValidationError("sanitizedBrownfield must be an object of row arrays");
  }
  const tables: Record<string, readonly DataRow[]> = {};
  for (const [table, rows] of Object.entries(value)) {
    if (!Array.isArray(rows)) {
      throw new RecipeValidationError(`sanitizedBrownfield.${table} must be an array`);
    }
    tables[table] = rows.map((row, index) => {
      if (!isRecord(row)) {
        throw new RecipeValidationError(`sanitizedBrownfield.${table}[${index}] must be an object`);
      }
      const copy: Record<string, DataValue> = {};
      for (const [column, cell] of Object.entries(row)) {
        if (!isDataValue(cell)) {
          throw new RecipeValidationError(
            `sanitizedBrownfield.${table}[${index}].${column} is not a scalar`,
          );
        }
        copy[column] = typeof cell === "string" ? cell.normalize("NFC") : cell;
      }
      return copy;
    });
  }
  return tables;
}

function isDataValue(value: unknown): value is DataValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
