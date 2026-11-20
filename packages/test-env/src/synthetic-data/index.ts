export { measureText, fitString, parseCheckExpression, parseColumnType } from "./bounds.js";
export { computeTableChecksums } from "./checksum.js";
export { assertSyntheticValue } from "./domains.js";
export {
  ConstraintViolationError,
  ForeignKeyViolationError,
  ProductionDataLeakError,
  RecipeValidationError,
  SchemaCycleDiagnostic,
  SchemaMetadataError,
  UniqueDomainExhaustedError,
} from "./errors.js";
export { SyntheticDataGenerator } from "./generate.js";
export { canonicalJson, sha256Hex } from "./hash.js";
export { SimulatedEmbeddedPostgres } from "./postgres-port.js";
export { hashSeedRecipe, parseRecipe, SeedRecipeSchema } from "./recipe.js";
export { normalizeSchema } from "./schema.js";
export { loadDatasetSqlite, openSqlite, assertForeignKeysEnabled } from "./sqlite-engine.js";
export {
  computeTemplateKey,
  DiskLane,
  environmentDatabaseName,
  hashMigrations,
  LocalSqliteFilePort,
  TemplateDatabaseManager,
} from "./template-manager.js";
export { planInsertion } from "./topology.js";
export {
  BOUNDARY_ROW_COUNT,
  DEFAULT_CUTOFF_INSTANT,
  DST_FALL_INSTANTS,
  DST_SPRING_INSTANTS,
  RESERVED_EMAIL_DOMAINS,
  SYNTHETIC_REFERENCE_INSTANT,
} from "./types.js";

export type {
  BoundaryCoverage,
  BulkSql,
  CloneHandle,
  ColumnSchema,
  DataRow,
  DataValue,
  EmbeddedPostgresProviderPort,
  GeneratedDataset,
  GeneratedTable,
  LengthUnit,
  LoadPlan,
  PostgresSession,
  PredecessorFixture,
  PruneResult,
  QueryResult,
  SchemaMetadata,
  SeedProfile,
  SeedRecipe,
  SpecBoundary,
  SqliteEnvProviderPort,
  TableChecksum,
  TableSchema,
  TemplateBuildRequest,
  TemplateHandle,
  TemplateManagerStats,
} from "./types.js";
export type { TemplateDatabaseManagerOptions } from "./template-manager.js";
