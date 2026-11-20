import type { DependencyIntent, Phase0Plan, Phase0Recipe, Phase0SelectionInput } from "./types.js";

/**
 * Local port for `Task 090` `Phase0RecipeGenerator`.
 * Sibling branch `task/090-master-planner-wave-budgets` is not merged.
 */
export interface Phase0RecipeGeneratorPort {
  generate(input: Phase0SelectionInput): Phase0Plan;
}

export interface Phase0CompileResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly recipes: readonly Phase0Recipe[];
  readonly hoistedIntents: readonly DependencyIntent[];
}

/**
 * Local port for `Task 092` `DeterministicGraphCompiler`.
 * Hoists parallel `package.json` writes into `P0.1` and checks disjoint scopes.
 */
export interface DeterministicGraphCompilerPort {
  compile(plan: Phase0Plan): Phase0CompileResult;
}

export interface InstallRequest {
  readonly taskId: string;
  readonly dependencies: readonly DependencyIntent[];
  readonly frozenLockfile: true;
  readonly offline: boolean;
}

export interface InstallResult {
  readonly ok: boolean;
  readonly lockfileBody: string;
  readonly lockfileHash: string;
  readonly packageDependencies: Readonly<Record<string, string>>;
  readonly error: string | null;
}

/**
 * Local port for `KernelPackageInstaller` (`Task 048` in this task's contract;
 * `Task 046` also exports that name). Workers never spawn `npm` or `pnpm`.
 */
export interface KernelPackageInstallerPort {
  install(request: InstallRequest): InstallResult;
}

export interface TestEnvHandle {
  readonly pid: number;
  readonly port: number;
}

export interface TestEnvTeardown {
  readonly leakedPids: readonly number[];
}

/**
 * Local port for `Task 050` `TestEnvOrchestrator`.
 * Leases a loopback port in `41000–48999`.
 */
export interface TestEnvOrchestratorPort {
  start(): Promise<TestEnvHandle>;
  health(handle: TestEnvHandle): Promise<boolean>;
  teardown(handle: TestEnvHandle): Promise<TestEnvTeardown>;
  dispose(): Promise<void>;
}

export interface MigrationResult {
  readonly ok: boolean;
  readonly templateDbHash: string;
  readonly error: string | null;
}

/** Local port for `Task 052` template DB seeding (`TemplateDbSeeder`). */
export interface TemplateDbSeederPort {
  migrate(repoPath: string): Promise<MigrationResult>;
}

export interface SecretFinding {
  readonly path: string;
  readonly reason: string;
}

/** Local port for `Task 036` gitleaks. */
export interface GitleaksPort {
  scan(repoPath: string, trackedFiles: readonly string[]): Promise<readonly SecretFinding[]>;
}

/** Local port for `Task 041` Windows Job Object orphan audit. */
export interface JobObjectAuditPort {
  orphanedPids(pids: readonly number[]): readonly number[];
}

export interface CasObject {
  readonly casId: string;
  readonly mime: string;
  readonly bytes: number;
}

/** Local stand-in for `Task 028` content-addressed storage. */
export interface ContentAddressedStore {
  put(body: Buffer, mime: string): CasObject;
  get(casId: string): Buffer | undefined;
}

export interface CommandRequest {
  readonly id: string;
  readonly display: string;
  readonly argv: readonly string[];
}

export interface CommandOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface CommandRunner {
  run(request: CommandRequest, cwd: string): Promise<CommandOutcome>;
}

export interface BaselineTestResult {
  readonly id: string;
  readonly status: "pass" | "fail";
  readonly preExisting: boolean;
}

export interface BaselineReport {
  readonly results: readonly BaselineTestResult[];
}

/** Local port for `Task 170` baseline test-health. */
export interface BaselineTestHealthPort {
  run(repoPath: string): Promise<BaselineReport>;
}

/** Local port for `Task 127` Action Cards. The controller persists the card. */
export interface ActionCardSink {
  publish(card: { readonly taskId: string; readonly message: string }): void;
}

/** Local port for `Task 121` Human-Step Probe. */
export interface HumanStepProbePort {
  escalate(input: { readonly tool: string; readonly reason: string }): void;
}

/** Local port for `Task 132` Component Downloader. */
export interface ComponentDownloaderPort {
  request(input: { readonly component: string; readonly reason: string }): void;
}

export interface TaskExecution {
  readonly files: Readonly<Record<string, string>>;
  readonly dependencyIntents: readonly DependencyIntent[];
  readonly attemptedCommands: readonly string[];
}

export interface TaskExecutionContext {
  readonly task: Phase0Recipe;
  readonly projectKind: Phase0Plan["projectKind"];
  readonly repoPath: string;
  readonly mode: "initial" | "repair";
  readonly attempt: number;
}

export interface Phase0TaskWorker {
  execute(context: TaskExecutionContext): Promise<TaskExecution>;
}
