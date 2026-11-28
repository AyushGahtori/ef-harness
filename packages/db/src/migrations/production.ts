import type { MigrationDefinition } from "./types.js";
import { codeIndexV2Migration, globalFootprintsV2Migration, stateV2Migration } from "./v2.js";

/**
 * Frozen `schema/*.sql` files are version 1.
 * Later shapes are forward migrations, not edits to those files.
 */
export const PRODUCTION_SCHEMA_VERSION = 1;

export const productionMigrations: readonly MigrationDefinition[] = Object.freeze([
  stateV2Migration,
  codeIndexV2Migration,
  globalFootprintsV2Migration,
]);
