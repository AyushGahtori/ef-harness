export const SANDBOX_TIER_IDS = ["A", "B", "C", "D"] as const;
export const TIER_PREFERENCE = ["A", "B", "D", "C"] as const;

export type SandboxTierId = (typeof SANDBOX_TIER_IDS)[number];
export type ReceiptTier = SandboxTierId | "UNSANDBOXED";
export type ExecutionMode = "own_loop" | "wrapped" | "stripped";
export type WeakerSandboxBadge = "weaker_sandbox_yellow";

export interface TierCapabilityFlags {
  readonly fileWritesEnforced: boolean;
  readonly secretReadsDenied: boolean;
  readonly networkEnforced: boolean;
  readonly requiresAdmin: boolean;
  readonly badge?: WeakerSandboxBadge;
}

export interface TierProbeResult {
  readonly tier: SandboxTierId;
  readonly available: boolean;
  readonly installed?: boolean;
  readonly wsl2Available?: boolean;
  readonly backend?: "docker" | "wsl2" | "none";
  readonly reason?: string;
  readonly requiresAdmin: boolean;
  readonly capabilities: TierCapabilityFlags;
}

export interface ProxyAdvisory {
  readonly http: string;
  readonly https: string;
  readonly noProxy: string;
}

export interface SandboxLaunchSpec {
  readonly projectId: string;
  readonly attemptId: string;
  readonly taskId: string;
  readonly worktreePath: string;
  readonly tempPath: string;
  readonly packageStorePath?: string;
  readonly projectPath: string;
  readonly mode: ExecutionMode;
  readonly proxy?: ProxyAdvisory;
  readonly limits?: {
    readonly memoryBytes?: number;
    readonly pidsLimit?: number;
    readonly cpus?: number;
  };
}

export interface CommandSpec {
  readonly commandId: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs?: number;
}

export interface SandboxInstance {
  readonly id: string;
  readonly tier: SandboxTierId;
  readonly worktreePath?: string;
  readonly tempPath?: string;
  readonly capabilitySid?: string;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
}

export interface WrappedProcessHandle {
  readonly pid: number;
  readonly tier: SandboxTierId;
}

export interface SandboxTierProvider {
  readonly tier: SandboxTierId;
  readonly capabilities: TierCapabilityFlags;
  probe(): Promise<TierProbeResult>;
  acquireWarmInstance(spec: SandboxLaunchSpec): Promise<SandboxInstance>;
  executeCommand(instance: SandboxInstance, command: CommandSpec): Promise<CommandResult>;
  spawnWrappedProcess(spec: SandboxLaunchSpec): Promise<WrappedProcessHandle>;
  disposeInstance(instance: SandboxInstance): Promise<void>;
}

export interface JobHandle {
  readonly name: string;
}

export interface WindowsJobManager {
  createJob(spec: {
    readonly name: string;
    readonly memoryBytes?: number;
    readonly activeProcessLimit?: number;
  }): JobHandle;
  assignProcess(job: JobHandle, pid: number): void;
  closeJob?(job: JobHandle): void;
}

export interface TaskSandboxSpec {
  readonly taskId: string;
  readonly attemptId: string;
  readonly projectId: string;
  readonly projectPath: string;
  readonly worktreePath: string;
  readonly tempPath: string;
  readonly packageStorePath?: string;
  readonly commands: readonly (string | readonly string[])[];
  readonly needsExternalNetwork?: boolean;
  readonly runsUntrustedDevServer?: boolean;
  readonly touchesUntrustedPackages?: boolean;
  readonly runsThirdPartyCodeBeyondLockedDeps?: boolean;
  readonly dependencyInstall?: boolean;
}

export interface RuntimeDispatch {
  readonly kind: "own_loop" | "foreign_agent";
  readonly runtimeId: string;
  readonly requestedMode?: ExecutionMode;
}

export type TierCBlockReason =
  | "dependency_install"
  | "external_network"
  | "untrusted_dev_server"
  | "untrusted_packages"
  | "third_party_code";

export interface TierCEligibility {
  readonly eligible: boolean;
  readonly badge: WeakerSandboxBadge;
  readonly blocks: readonly TierCBlockReason[];
  readonly requiredTiers: readonly ("A" | "B" | "D")[];
  readonly wrappedForbidden: boolean;
  readonly forcedMode: ExecutionMode;
  readonly explanation: string;
}

export interface HoldOffer {
  readonly id: "setup_tier_b" | "install_docker_tier_d" | "unsandboxed_red_warning_override";
  readonly label: string;
}

export interface TaskHold {
  readonly held: true;
  readonly executed: false;
  readonly reason: "sandbox_tier_insufficient";
  readonly explanation: string;
  readonly offers: readonly HoldOffer[];
  readonly alternative: "held" | "native_worker_loop_held";
}

export interface VerificationReceipt {
  readonly taskId: string;
  readonly attemptId: string;
  readonly commandId: string;
  readonly tier: ReceiptTier;
  readonly mode: ExecutionMode;
  readonly sandboxTier: ReceiptTier;
  readonly redBannerWarning: boolean;
  readonly badge?: WeakerSandboxBadge;
  readonly recordedAt: string;
}

export interface TaskCardStamp {
  readonly taskId: string;
  readonly sandboxTier: ReceiptTier;
  readonly redBannerWarning: boolean;
  readonly mode: ExecutionMode;
  readonly badge?: WeakerSandboxBadge;
  readonly held: boolean;
  readonly holdReason?: "sandbox_tier_insufficient";
}

export interface ProjectSandboxSettings {
  runUnsandboxed: boolean;
  pinTierDForLinuxParity: boolean;
}

export type PathClass = "local" | "unc" | "network";

export type LinuxParityKind = "filename_case" | "line_endings" | "path_separator" | "native_package";
