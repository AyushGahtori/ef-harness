export type SandboxTier = "A" | "B" | "C" | "D";

export type ExecutionMode = "per_command" | "wrapped" | "stripped";

export type WrappedVendor =
  | "codex"
  | "claude_code"
  | "copilot"
  | "cursor"
  | "gemini"
  | "opencode";

export type SandboxAccountKind = "offline" | "online";

export type CommandPurpose = "coding_worker" | "kernel_proxy" | "test_endpoint";

export interface TierCapabilityFlags {
  readonly fileWritesEnforced: boolean;
  readonly secretReadsDenied: boolean;
  readonly networkEnforced: boolean;
  readonly requiresAdmin: boolean;
}

export interface TierProbeResult {
  readonly tier: SandboxTier;
  readonly capabilities: TierCapabilityFlags;
  readonly available: boolean;
  readonly reason: string | null;
}

export interface TierBProbe extends TierProbeResult {
  readonly tier: "B";
  readonly provisioned: boolean;
  readonly firewallActive: boolean;
  readonly missingComponents: readonly string[];
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
  readonly mode: "per_command" | "wrapped";
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
  readonly detach?: boolean;
  readonly purpose?: CommandPurpose;
  readonly kernelApproved?: boolean;
  readonly declaredEndpoints?: readonly string[];
}

export interface WrappedProcessSpec extends SandboxLaunchSpec {
  readonly vendor: WrappedVendor;
  readonly command: string;
  readonly args?: readonly string[];
  readonly token?: string;
  readonly tokenKind?: "console_api_key" | "client_supplied" | "subscription";
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

export interface DenialAuditEvent {
  readonly type: "sandbox_denial";
  readonly tier: "B";
  readonly attemptId: string;
  readonly target: string;
  readonly access: "read" | "write" | "network";
  readonly errno: "EACCES" | "EPERM";
  readonly ruleId: string;
  readonly source: "policy" | "os";
}

export interface LaunchLatencySample {
  readonly tier: "B";
  readonly attemptId: string;
  readonly latencyMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

export interface SandboxAuditEntry {
  readonly ts: string;
  readonly level: "info" | "warn" | "error";
  readonly component: "tier-b-users";
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
  readonly enforcement: "os_tier_b" | "test_double";
  readonly account: string;
  readonly desktop: string | null;
}

export interface SandboxInstance {
  readonly id: string;
  readonly tier: SandboxTier;
  readonly generation: number;
  readonly attemptId: string | null;
  readonly tempDir: string | null;
}

export interface WrappedProcessHandle {
  readonly instance: SandboxInstance;
  readonly pid: number;
  readonly vendor: WrappedVendor;
  readonly providerHosts: readonly string[];
  readonly enforcement: "os_tier_b" | "test_double";
  readonly mode: "wrapped";
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

export interface PortRange {
  readonly start: number;
  readonly end: number;
}

export interface FirewallRuleSpec {
  readonly name: string;
  readonly direction: "out";
  readonly action: "block";
  readonly enabled: true;
  readonly localUser: string;
  readonly protocol: "any" | "tcp" | "udp";
  readonly remoteAddresses: readonly string[];
  readonly remotePorts: readonly PortRange[] | "any";
  readonly profile: "any";
  readonly edgeTraversal: "no";
  readonly permitsLoopbackTcp: readonly number[];
}

export interface VolumeInfo {
  readonly fileSystem: string;
  readonly unc: boolean;
  readonly devDrive: boolean;
}

export interface VolumeAssessment {
  readonly accepted: boolean;
  readonly kind: "ntfs" | "refs" | "dev_drive" | "fat32" | "fat" | "exfat" | "unc" | "unsupported";
  readonly guidance: string | null;
}

export interface FirewallObservation {
  readonly name: string;
  readonly present: boolean;
  readonly enabled: boolean;
  readonly specHash: string | null;
}

export interface TierBHostInspector {
  accountExists(name: string): boolean;
  firewallRule(name: string): FirewallObservation;
  dpapiCredentialValid(account: string): boolean;
}

export interface AclAce {
  readonly target: string;
  readonly sid: string;
  readonly type: "allow" | "deny";
  readonly rights: "M" | "RX" | "DENY_WRITE";
  readonly inheritance: "(OI)(CI)";
  readonly recursive: false;
  readonly role: "sandbox_user" | "slot_capability" | "store_readonly" | "git_deny_write";
}

export interface AclCommand {
  readonly program: "icacls";
  readonly args: readonly string[];
  readonly recursive: false;
  readonly ace: AclAce;
}

export interface AclPort {
  apply(command: AclCommand): void;
  list(target: string): readonly AclAce[];
}

export interface SlotGrant {
  readonly slotPath: string;
  readonly accountSid: string;
  readonly capabilitySid: string;
  readonly role: "slot" | "temp" | "storage_root";
}

export interface SettingsConsent {
  readonly source: "settings_sandbox_setup";
  readonly explicit: true;
  readonly uacAccepted: true;
  readonly action: "provision" | "unprovision";
}

export interface ProtectedSecret {
  readonly account: string;
  readonly protection: "dpapi" | "lsa";
  readonly ownerSid: string;
  readonly blob: string;
}

export interface SecretProtector {
  protect(account: string, plaintext: string, ownerSid: string): ProtectedSecret;
  unprotect(secret: ProtectedSecret, callerSid: string): string | null;
  delete(account: string): void;
  list(): readonly string[];
}

export interface ScriptInvocation {
  readonly file: string;
  readonly args: readonly string[];
  readonly script: string;
  readonly stdin: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdinIsSecret: true;
}

export interface ScriptResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ScriptRunner {
  run(invocation: ScriptInvocation): Promise<ScriptResult>;
}

export interface ProvisionPlan {
  readonly accounts: readonly string[];
  readonly adminGroupMembership: false;
  readonly interactiveLogon: "denied";
  readonly denyLogonRights: readonly ["SeDenyInteractiveLogonRight", "SeDenyRemoteInteractiveLogonRight"];
  readonly passwordStorage: "dpapi_or_lsa";
  readonly passwordEmbeddedInScript: false;
  readonly firewallRules: readonly FirewallRuleSpec[];
  readonly script: string;
  readonly consent: "required";
  readonly silent: false;
}

export interface DeprovisionPlan {
  readonly accountsRemoved: readonly string[];
  readonly firewallRulesRemoved: readonly string[];
  readonly vaultEntriesRemoved: readonly string[];
  readonly script: string;
  readonly consent: "required";
  readonly reversible: true;
}

export interface ProvisionExplanation {
  readonly code: number;
  readonly api: "NetUserAdd" | "NetUserDel" | "Firewall";
  readonly policyBlocked: boolean;
  readonly summary: string;
  readonly fallbackTiers: readonly ("A" | "D" | "C")[];
}

export interface ProcessAsUserDiagnostic {
  readonly api: "CreateProcessAsUserW";
  readonly win32Error: number;
  readonly message: string;
  readonly edrHint: string;
  readonly logEvent: "tier_b_create_process_as_user_failed";
}

export interface DesktopIsolationPlan {
  readonly supported: boolean;
  readonly applied: boolean;
  readonly interactive: false;
  readonly windowStation: string | null;
  readonly desktop: string | null;
  readonly lpDesktop: string | null;
  readonly blocksSendInput: boolean;
  readonly reason: string | null;
}

export interface RestrictedLogonPlan {
  readonly apis: readonly ["LogonUser", "CreateRestrictedToken", "CreateProcessAsUserW"];
  readonly account: string;
  readonly restrictingSids: readonly string[];
  readonly desktop: DesktopIsolationPlan;
  readonly jobNested: true;
  readonly env: Readonly<Record<string, string>>;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly directExternalTcp: "deny";
  readonly proxyDeclaredEndpoints: readonly string[];
  readonly enforcement: "os_tier_b" | "test_double";
}

export interface LogonLaunchResult {
  readonly pid: number;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly enforcement: "os_tier_b" | "test_double";
}

export interface LogonExecutor {
  readonly enforcement: "os_tier_b" | "test_double";
  launch(plan: RestrictedLogonPlan): Promise<LogonLaunchResult>;
}

export interface TierBModeDecision {
  readonly vendor: WrappedVendor;
  readonly requested: "wrapped" | "stripped";
  readonly mode: "wrapped" | "stripped";
  readonly reason: "file_login_on_tier_b" | "token_vendor" | "requested_stripped" | "wrapped_without_token";
  readonly tokenEnv: string | null;
  readonly sdkField: string | null;
  readonly homeAclMutations: readonly [];
}

export interface CompiledTierBPolicy {
  readonly tier: "B";
  readonly attemptId: string;
  readonly capabilitySid: string;
  readonly rules: readonly PolicyRule[];
  readonly writable: readonly string[];
  readonly readOnly: readonly string[];
  readonly denyRead: readonly string[];
  readonly denyWrite: readonly string[];
  readonly network: {
    readonly nonLoopback: "deny";
    readonly loopback: "proxy_and_mcp_only";
    readonly proxyPort: number;
    readonly mcpPort: number;
  };
}

export interface LiveProbeRow {
  readonly testId: "read_ssh" | "read_dpapi" | "write_outside_worktree" | "write_git" | "raw_external_tcp";
  readonly expectedBlocked: true;
  readonly actuallyBlocked: boolean;
  readonly executed: boolean;
  readonly detail: string;
}

export interface LiveRedTeamReport {
  readonly status: "skipped_unprovisioned" | "skipped_not_opted_in" | "not_run" | "executed";
  readonly reason: string;
  readonly claimedOsEnforcement: boolean;
  readonly probes: readonly LiveProbeRow[];
  readonly host: TierBProbe;
}
