export { NodeBinaryLauncher, type BinarySpawnSpec, type SpawnedServiceProcess } from "./binary-launcher.js";
export { ManualClock, systemClock, type Clock, type TimeoutHandle } from "./clock.js";
export {
  asStartFailure,
  ServiceStartFailedError,
  UnrecordedHttpRequestError,
  UnsupportedPostgresExtensionError,
  UploadRejectedError,
  type StartableService,
} from "./errors.js";
export {
  EmbeddedPostgresBinaryLauncher,
  EmbeddedPostgresProvider,
  postgresServerArgs,
  type EmbeddedPostgresOptions,
  type PostgresAdminSession,
  type PostgresClusterLauncher,
  type PostgresClusterRuntime,
  type PostgresConnection,
  type PostgresLaunchRequest,
} from "./embedded-postgres-provider.js";
export {
  FilesystemCassetteStore,
  HttpRecordReplayProvider,
  normalizedHttpUrl,
  type CassetteStore,
  type HttpRecordReplayOptions,
  type HttpReplayConnection,
  type RecordedHttpExchange,
} from "./http-record-replay-provider.js";
export {
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME,
  pidIsAlive,
  TrackingWindowsJobManager,
  type JobAccounting,
  type JobHandle,
  type JobLimits,
  type WindowsJobManager,
} from "./job.js";
export {
  LocalObjectStorageProvider,
  type LocalObjectStorageOptions,
  type ObjectStorageConnection,
} from "./local-object-storage-provider.js";
export {
  addressMatchesDomain,
  mailpitDeleteBody,
  mailpitLaunchArgs,
  mailpitRecipientDomain,
  mailpitSearchQuery,
  messageMatchesEnv,
  parseMailpitSearch,
  type MailpitAddress,
  type MailpitMessage,
} from "./mailpit.js";
export {
  MailpitBinaryLauncher,
  MailpitProvider,
  type MailpitConnection,
  type MailpitLauncher,
  type MailpitLaunchRequest,
  type MailpitProviderOptions,
  type MailpitRuntime,
} from "./mailpit-provider.js";
export { listenLoopback, readLimitedBody, reserveLoopbackPort, waitForTcp } from "./net-util.js";
export {
  componentBinary,
  efHarnessHome,
  existingComponent,
  projectServiceDir,
  readRedisDecisionText,
  type ComponentName,
} from "./paths.js";
export {
  buildCreateDatabaseCommands,
  buildDropDatabaseCommands,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  EMBEDDED_POSTGRES_EXTENSIONS,
  LIVE_EXTENSION_SQL,
  postgresConnectionString,
  postgresDatabaseName,
  statementTimeoutOption,
  type SqlCommand,
} from "./postgres-sql.js";
export { RedisDbIndexAllocator, REDIS_DB_INDEX_COUNT, type RedisDbAssignment, type RedisPlacement } from "./redis-allocator.js";
export {
  RedisBinaryLauncher,
  RedisCompatibleProvider,
  type RedisClusterLauncher,
  type RedisCompatibleOptions,
  type RedisConnection,
  type RedisLaunchRequest,
  type RedisServerRuntime,
} from "./redis-compatible-provider.js";
export {
  DANGEROUS_SHARED_REDIS_COMMANDS,
  isDangerousSharedRedisCommand,
  redisBackendArgs,
  renderRedisIsolationConfig,
  resolveRedisServerChoice,
  type RedisServerKind,
} from "./redis-config.js";
export {
  encodeRespCommand,
  flushRedisIndexes,
  RedisClient,
  RedisProtocolServer,
  RespStreamParser,
  startRedisGuardProxy,
  type RespFrame,
} from "./redis-protocol.js";
export { DefaultSecretRedactor, type SecretRedactor } from "./secret-redactor.js";
export { ProjectSharedServerPool, type AcquiredServer } from "./shared-server.js";
export { SqliteEnvProvider, type SqliteConnection } from "./sqlite-env-provider.js";
export type {
  BackingServiceKind,
  EnvironmentDegradation,
  EnvironmentKind,
  ProcessExitEvent,
  ServiceConnection,
  ServiceCreateRequest,
  ServiceProvider,
  ServiceTier,
} from "./types.js";
export {
  assertStorageOutsidePublicWeb,
  assertUploadAllowed,
  DEFAULT_UPLOAD_POLICY,
  normalizeContentType,
  safeObjectSegments,
  type UploadPolicy,
} from "./upload-rules.js";

import type { ServiceProvider } from "./types.js";
import { EmbeddedPostgresProvider as PostgresProvider } from "./embedded-postgres-provider.js";
import { HttpRecordReplayProvider as HttpProvider } from "./http-record-replay-provider.js";
import { LocalObjectStorageProvider as S3Provider } from "./local-object-storage-provider.js";
import { MailpitProvider as MailProvider } from "./mailpit-provider.js";
import { RedisCompatibleProvider as RedisProvider } from "./redis-compatible-provider.js";
import { SqliteEnvProvider as SqliteProvider } from "./sqlite-env-provider.js";

export interface BackingServiceRegistry {
  readonly sqlite: SqliteProvider;
  readonly postgres: PostgresProvider;
  readonly redis: RedisProvider;
  readonly mail: MailProvider;
  readonly s3: S3Provider;
  readonly httpReplay: HttpProvider;
  readonly providers: readonly ServiceProvider[];
}

/** The six native Windows backing-service providers produced by this task. */
export function createBackingServiceRegistry(): BackingServiceRegistry {
  const sqlite = new SqliteProvider();
  const postgres = new PostgresProvider();
  const redis = new RedisProvider();
  const mail = new MailProvider();
  const s3 = new S3Provider();
  const httpReplay = new HttpProvider();
  return {
    sqlite,
    postgres,
    redis,
    mail,
    s3,
    httpReplay,
    providers: [sqlite, postgres, redis, mail, s3, httpReplay],
  };
}
