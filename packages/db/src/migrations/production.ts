import type { MigrationDefinition } from "./types.js";

/**
 * schema/state.sql and schema/global.sql are schema version 1.
 * Real v2 changes stay out of this package; tests supply synthetic migrations.
 */
export const PRODUCTION_SCHEMA_VERSION = 1;

export const productionMigrations: readonly MigrationDefinition[] = Object.freeze([]);
