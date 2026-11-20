export type SandboxTier = "A" | "B" | "C" | "D";

export type ExecutionMode = "per_command" | "wrapped";

export type WrappedVendor =
  | "codex"
  | "claude_code"
  | "copilot"
  | "cursor"
  | "gemini"
  | "opencode";

export interface TierCapabilityFlags {
  readonly fileWritesEnforced: boolean;
  readonly secretReadsDenied: boolean;
  readonly networkEnforced: boolean;
  readonly requiresAdmin: boolean;
}

export const TIER_A_CAPABILITIES: TierCapabilityFlags = {
  fileWritesEnforced: true,
  secretReadsDenied: true,
  networkEnforced: true,
  requiresAdmin: false,
};

export interface MxcAvailability {
  readonly available: boolean;
  readonly osBuild: string;
  readonly reason: "os_build_too_old" | "not_windows" | "os_build_unreadable" | null;
  readonly policyBasedGrants: boolean;
  readonly buildEligible: boolean;
  readonly runtimeExportPresent: boolean;
  readonly helperPresent: boolean;
  readonly launchable: boolean;
  readonly launchBlocker:
    | "os_build_too_old"
    | "not_windows"
    | "os_build_unreadable"
    | "mxc_runtime_export_missing"
    | "mxc_requires_pinned_helper"
    | null;
}

export interface TierProbeResult extends MxcAvailability {
  readonly tier: SandboxTier;
  readonly capabilities: TierCapabilityFlags;
}

export interface SandboxLaunchSpec {
  readonly attemptId: string;
  readonly taskId?: string;
  readonly projectId?: string;
  readonly worktree: string;
  readonly tempDir: string;
  readonly buildOutputDir: string;
  readonly developerCheckout: string;
  readonly harnessDataRoot: string;
  readonly userProfile: string;
  readonly localAppData: string;
  readonly appData: string;
  readonly toolchainRoots: readonly string[];
  readonly pnpmStore: string;
  readonly otherWorktrees: readonly string[];
  readonly mcpPort: number;
  readonly proxyPort: number;
  readonly mode: ExecutionMode;
  readonly vendor?: WrappedVendor;
  readonly gitDirLink?: string;
  readonly gitCommonDir?: string;
  readonly jobMemoryBytes?: number;
  readonly activeProcessLimit?: number;
}

export interface CommandSpec {
  readonly command: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  readonly background?: boolean;
  readonly detach?: boolean;
}

export interface WrappedProcessSpec extends SandboxLaunchSpec {
  readonly vendor: WrappedVendor;
  readonly command: string;
  readonly args?: readonly string[];
  readonly token?: string;
  readonly timeoutMs?: number;
}

export type AccessKind = "read" | "write";

export interface AccessDecision {
  readonly allowed: boolean;
  readonly errno: "EACCES" | "EPERM" | null;
  readonly ruleId: string;
  readonly access: AccessKind;
}

export interface NetworkDecision {
  readonly allowed: boolean;
  readonly errno: "EACCES" | "EPERM" | null;
  readonly ruleId: string;
  readonly host: string;
  readonly port: number;
}

export interface PolicyRule {
  readonly id: string;
  readonly kind: "writable" | "read_only" | "deny_read" | "deny_write";
  readonly path: string;
}

export interface MxcNuances {
  readonly denyReadGlobsEvaluatedAtProcessStart: true;
  readonly foregroundExitStopsChildren: true;
  readonly detachedServersOwner: "task_049_environment_orchestrator";
  readonly postStartFileMayEscapeFileGlobSnapshot: true;
  readonly platformLoopbackIsBidirectional: true;
  readonly allowLocalBinding: true;
}

export interface MxcNetworkPolicy {
  readonly nonLoopback: "deny";
  readonly loopback: "allow_listed_ports_only";
  readonly allowLoopbackPorts: readonly number[];
  readonly providerHosts: readonly string[];
  readonly proxyProfile: "coding_worker" | "wrapped_vendor";
  readonly rawExternalTcp: "deny";
  readonly proxyPort: number;
  readonly mcpPort: number;
}

export interface MxcLaunchMetadata {
  readonly entry: "Experimental_CreateProcessInSandbox";
  readonly dll: "processmodel.dll";
  readonly loadFlag: "LOAD_LIBRARY_SEARCH_SYSTEM32";
  readonly specIdentifier: "SBOX";
  readonly failOpen: false;
  readonly helperName: "ef-mxc-launch";
  readonly helperPin: "openai/codex@rust-v0.162.1#codex-rs/mxc-sandbox";
  readonly callsExportDirectly: false;
  readonly grantModel: "policy";
  readonly aclMutation: false;
}

export interface CompiledMxcPolicy {
  readonly tier: "A";
  readonly version: 1;
  readonly policyBasedGrants: true;
  readonly mode: ExecutionMode;
  readonly vendor: WrappedVendor | null;
  readonly attemptId: string;
  readonly writable: readonly string[];
  readonly readOnly: readonly string[];
  readonly denyRead: readonly string[];
  readonly denyWrite: readonly string[];
  readonly rules: readonly PolicyRule[];
  readonly network: MxcNetworkPolicy;
  readonly nuances: MxcNuances;
  readonly launch: MxcLaunchMetadata;
  readonly frozenAt: string;
}

export interface DenialAuditEvent {
  readonly type: "sandbox_denial";
  readonly tier: "A";
  readonly attemptId: string;
  readonly target: string;
  readonly access: "read" | "write" | "network";
  readonly errno: "EACCES" | "EPERM";
  readonly ruleId: string;
  readonly source: "policy" | "os";
}

export interface LaunchLatencySample {
  readonly tier: "A";
  readonly attemptId: string;
  readonly latencyMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

export interface SandboxAuditEntry {
  readonly ts: string;
  readonly level: "info" | "warn" | "error";
  readonly component: "tier-a-mxc";
  readonly msg: string;
  readonly fields: Readonly<Record<string, string | number | boolean>>;
}

export interface SandboxAuditLogger {
  write(entry: SandboxAuditEntry): void;
}

export interface SandboxGovernorSink {
  reportLaunchLatency(sample: LaunchLatencySample): void;
  reportDenial(event: DenialAuditEvent): void;
}

export interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly pid: number;
  readonly denied: readonly DenialAuditEvent[];
  readonly latencyMs: number;
  readonly enforcement: "os_mxc" | "test_double";
  readonly frozenAt: string;
}

export interface SandboxInstance {
  readonly id: string;
  readonly tier: "A";
  readonly generation: number;
  readonly attemptId: string | null;
  readonly tempDir: string | null;
  readonly policy: CompiledMxcPolicy | null;
}

export interface WrappedProcessHandle {
  readonly instance: SandboxInstance;
  readonly pid: number;
  readonly vendor: WrappedVendor;
  readonly providerHosts: readonly string[];
  readonly enforcement: "os_mxc" | "test_double";
}

export interface SandboxTierProvider {
  readonly tier: SandboxTier;
  readonly capabilities: TierCapabilityFlags;
  probe(): Promise<TierProbeResult>;
  acquireWarmInstance(spec: SandboxLaunchSpec): Promise<SandboxInstance>;
  executeCommand(instance: SandboxInstance, cmdSpec: CommandSpec): Promise<CommandResult>;
  spawnWrappedProcess(spec: WrappedProcessSpec): Promise<WrappedProcessHandle>;
  disposeInstance(instance: SandboxInstance): Promise<void>;
}

export interface JobLimits {
  readonly killOnJobClose: true;
  readonly jobMemoryBytes: number;
  readonly activeProcessLimit: number;
  readonly cpuRateControlPercent?: number;
  readonly uiRestrictions: true;
}

export interface JobHandle {
  readonly id: string;
  readonly name: string;
  close(): Promise<void>;
}

export interface JobAccounting {
  readonly peakJobMemoryUsed: number;
  readonly currentWorkingSet: number;
  readonly totalUserTimeMs: number;
  readonly totalKernelTimeMs: number;
  readonly activeProcesses: number;
}

export interface WindowsJobManagerPort {
  createJob(name: string, limits: JobLimits, parent?: JobHandle): Promise<JobHandle>;
  assignProcess(job: JobHandle, pid: number): Promise<void>;
  queryJobAccounting(job: JobHandle): Promise<JobAccounting>;
  terminateJob(job: JobHandle, reason: string): Promise<void>;
}

export interface OsDenial {
  readonly access: "read" | "write" | "network";
  readonly target: string;
  readonly errno: "EACCES" | "EPERM";
  readonly ruleId: string;
}

export interface MxcKernelLaunchRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly policy: CompiledMxcPolicy;
  readonly tempDir: string;
  readonly attemptId: string;
  readonly mode: ExecutionMode;
  readonly stdinPayload: string;
}

export interface MxcLaunchContext {
  readonly signal: AbortSignal;
  readonly onStarted?: (pid: number) => void | Promise<void>;
}

export interface MxcKernelLaunchResult {
  readonly launched: true;
  readonly pid: number;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly denied: readonly OsDenial[];
}

export interface MxcKernelBackend {
  readonly kind: "pinned_helper" | "test_double";
  launch(request: MxcKernelLaunchRequest, context: MxcLaunchContext): Promise<MxcKernelLaunchResult>;
}

export interface SpawnRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: string;
  readonly signal: AbortSignal;
  readonly onPid?: (pid: number) => void | Promise<void>;
}

export interface SpawnResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly pid: number;
}

export interface ProcessSpawner {
  spawn(request: SpawnRequest): Promise<SpawnResult>;
}
