import type { PreviewTimings } from "./timings.js";

export type HardwarePressure = "GREEN" | "ORANGE" | "RED";

export type PreviewSecretScope = "dev" | "test" | "live" | "prod" | "production";

export type PreviewSecretKind = "stripe" | "smtp" | "s3" | "oauth" | "other";

export interface PreviewSecret {
  readonly name: string;
  readonly value: string;
  readonly scope: PreviewSecretScope;
  readonly kind: PreviewSecretKind;
}

export interface PortLease {
  readonly port: number;
  readonly projectId: string;
  readonly environment: string;
  readonly purpose: "live-preview" | "preview-db";
}

/**
 * Local stand-in for Task 014 `leasePort` / `releasePort` on `global.db.port_leases`.
 * Integration swaps `LocalPortLeaseRepo` for the broker repository.
 */
export interface PortLeaseRepo {
  lease(input: {
    readonly projectId: string;
    readonly environment: string;
    readonly purpose: PortLease["purpose"];
    readonly port?: number;
  }): Promise<PortLease>;
  releaseHolder(port: number): Promise<void>;
  hold(port: number): Promise<void>;
  release(port: number): Promise<void>;
  list(): readonly PortLease[];
}

export interface IntegrationCheckout {
  readonly projectId: string;
  readonly slot: "integration";
  readonly worktreePath: string;
  readonly headSha: string;
  readonly ref: "harness/integration";
  readonly decoupledFromDeveloperCheckout: true;
  readonly decoupledFromWorkerSlots: true;
}

/**
 * Local stand-in for Task 038 `WorktreeSlotManager.ensureIntegrationWorktree`
 * and `fastForwardIntegration`. Preview never receives an attempt or merge slot.
 */
export interface WorktreeSlotPool {
  integrationPath(): string;
  materialize(sha: string): Promise<IntegrationCheckout>;
  noteHead(sha: string): Promise<IntegrationCheckout>;
  headSha(): string;
  shutdown?(): Promise<void>;
}

export interface SupervisedExit {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SupervisedProcess {
  readonly jobId: string;
  readonly pid: number;
  readonly killOnClose: true;
  readonly exited: Promise<SupervisedExit>;
  poll(): SupervisedExit | null;
  stdout(): string;
  stderr(): string;
}

export interface SpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Local stand-in for Task 040 `WindowsJobManager` nested by Task 041.
 * `killOnClose` matches `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: closing the job
 * or quitting the daemon terminates the preview process tree.
 */
export interface WindowsJobSupervisor {
  readonly killOnJobClose: true;
  spawn(input: SpawnRequest): Promise<SupervisedProcess>;
  terminate(jobId: string): Promise<void>;
  activePids(): readonly number[];
  leakedPids(): readonly number[];
  close(): Promise<void>;
  spawnContainedSecret(secret: string): boolean;
  lastCwd(): string | null;
  lastArgs(): readonly string[];
}

export interface PreparedPreviewEnv {
  readonly env: Readonly<Record<string, string>>;
  readonly argv: readonly string[];
  readonly shell: false;
}

/**
 * Local stand-in for Task 120 `RuntimeOnlyEnvInjector`.
 * Secrets are copied only into the child environment block, never argv.
 */
export interface RuntimeOnlyEnvInjector {
  prepare(input: {
    readonly command: string;
    readonly args: readonly string[];
    readonly secrets: readonly PreviewSecret[];
    readonly extras: Readonly<Record<string, string>>;
  }): PreparedPreviewEnv;
  redact(text: string): string;
}

export interface GuardDecision {
  readonly allowed: boolean;
  readonly code: string;
  readonly message: string;
}

/**
 * Local stand-in for Task 120 `LiveKeyTestRefusalGuard`.
 * Live and production secrets are refused before a preview process is spawned.
 */
export interface LiveKeyTestRefusalGuard {
  inspect(secret: PreviewSecret): GuardDecision;
  assertPreviewSecrets(secrets: readonly PreviewSecret[]): void;
}

export interface TemplateCloneResult {
  readonly snapshotId: string;
  readonly snapshotPath: string;
}

/** Local stand-in for Task 052 `TemplateDatabaseManager.cloneFromTemplate`. */
export interface TemplateDbSeeder {
  snapshotPath(projectId: string): string;
  cloneFunctionalSeed(projectId: string, destPath: string): TemplateCloneResult;
}

/** Local stand-in for Task 050 `TestEnvOrchestrator` template databases. */
export interface TestEnvOrchestrator {
  templateDatabasePath(projectId: string): string;
  ensureTemplate(projectId: string): string;
}

export interface SqlMigration {
  readonly id: string;
  readonly sql: string;
  readonly featureId: string;
}

/**
 * Local stand-in for Task 111 `PreviewReloadEvent`.
 * `schemaChanged` / `configChanged` are optional extensions: when both are false
 * the runner hot-reloads instead of restarting. Task 111's signal always sets
 * `restartPreview: true` and omits those flags, which restarts without wiping demo data.
 */
export interface PreviewReloadSignal {
  readonly kind: "preview-reload";
  readonly featureIds: readonly string[];
  readonly integrationSha: string;
  readonly restartPreview: true;
  readonly schemaChanged?: boolean;
  readonly configChanged?: boolean;
  readonly migrations?: readonly SqlMigration[];
}

export interface PreviewTarget {
  readonly kind: "web" | "cli";
  readonly command: string;
  readonly args: readonly string[];
}

export interface PreviewScheduler {
  schedule(delayMs: number, fn: () => void | Promise<void>): { cancel(): void };
}

export interface PreviewSnapshot {
  readonly state: "idle" | "running" | "suspended" | "failed" | "stopped";
  readonly mode: "web" | "cli" | null;
  readonly port: number | null;
  readonly dbPort: number | null;
  readonly pid: number | null;
  readonly commitSha: string | null;
  readonly worktreePath: string | null;
  readonly origin: string | null;
  readonly url: string | null;
  readonly path: string;
  readonly pill: string | null;
  readonly banner: string | null;
  readonly stderrRedacted: string | null;
  readonly everStarted: boolean;
  readonly serverProcesses: number;
  readonly ramBytes: number;
  readonly cpuPercent: number;
  readonly leakedPids: readonly number[];
  readonly databaseName: string;
  readonly openedBy: "tab" | "pop-out" | null;
}

export interface TeardownReport {
  readonly reason: "project-switch" | "quit";
  readonly leakedPids: readonly number[];
  readonly leasedPorts: number;
}

export interface MergeRefreshResult {
  readonly mode: "hmr" | "restart" | "fallback" | "deferred";
  readonly pill: string;
  readonly path: string;
  readonly commitSha: string | null;
  readonly pid: number | null;
  readonly banner: string | null;
  readonly state: PreviewSnapshot["state"];
}

export interface CliResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SendErrorToFixRequest {
  readonly task: 161;
  readonly type: "send-error-to-fix";
  readonly projectId: string;
  readonly commitSha: string;
  readonly stderrRedacted: string;
}

export interface LivePreviewDeps {
  readonly projectId: string;
  readonly headSha: string;
  readonly target: PreviewTarget;
  readonly secrets: readonly PreviewSecret[];
  readonly ports: PortLeaseRepo;
  readonly worktrees: WorktreeSlotPool;
  readonly jobs: WindowsJobSupervisor;
  readonly env: RuntimeOnlyEnvInjector;
  readonly guard: LiveKeyTestRefusalGuard;
  readonly demo: PersistentDemoDb;
  readonly fallback: LastGoodFallbackPort;
  readonly scheduler: PreviewScheduler;
  readonly timings: PreviewTimings;
  readonly engine: "sqlite" | "postgres";
  shutdown?(): Promise<void>;
}

export interface PersistentDemoDb {
  readonly engine: "sqlite" | "postgres";
  databaseFile(): string;
  databaseName(): string;
  connectionString(dbPort: number | null): string;
  ensureSeeded(): void;
  assertCanApply(migrations: readonly SqlMigration[]): void;
  applyAdditiveMigrations(migrations: readonly SqlMigration[]): { readonly appliedIds: readonly string[] };
  resetDemoData(): { readonly elapsedMs: number };
  startEndpoint(port: number): Promise<void>;
  stopEndpoint(): Promise<void>;
  close(): void;
}

export interface HealthyBootRecord {
  readonly projectId: string;
  readonly lastGoodPreviewCommitSha: string;
  readonly httpStatus: 200;
  readonly startupCrashes: 0;
  readonly bootMs: number;
}

export interface FallbackPlan {
  readonly restoreSha: string | null;
  readonly banner: string;
  readonly stderrRedacted: string;
  readonly detectedWithinMs: number;
  readonly withinCrashWindow: boolean;
  readonly reason: "exit_nonzero" | "health_timeout" | "startup_crash";
  readonly actions: readonly ["inspect_error", "send_error_to_fix"];
}

export interface LastGoodFallbackPort {
  recordHealthy(input: {
    readonly projectId: string;
    readonly sha: string;
    readonly httpStatus: number;
    readonly startupCrashes: number;
    readonly bootMs: number;
  }): boolean;
  current(projectId: string): HealthyBootRecord | null;
  planFailure(input: {
    readonly projectId: string;
    readonly attemptedSha: string;
    readonly detectedWithinMs: number;
    readonly stderr: string;
    readonly reason: FallbackPlan["reason"];
    readonly redact: (text: string) => string;
  }): FallbackPlan;
}
