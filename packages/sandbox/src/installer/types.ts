export const INSTALL_TIERS = ["A", "B", "D"] as const;
export type InstallTier = (typeof INSTALL_TIERS)[number];

export const SANDBOX_TIERS = ["A", "B", "C", "D", "UNSANDBOXED"] as const;
export type SandboxTier = (typeof SANDBOX_TIERS)[number];

export const INSTALL_ACTORS = ["kernel", "integrator", "worker"] as const;
export type InstallActor = (typeof INSTALL_ACTORS)[number];

export const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export const NETWORK_PROFILES = [
  "coding_worker",
  "verifier_test",
  "kernel_installer",
  "researcher",
  "wrapped_vendor",
] as const;
export type NetworkPolicyProfile = (typeof NETWORK_PROFILES)[number];

export interface KernelInstallerProxy {
  readonly profile: NetworkPolicyProfile;
  readonly proxyUrl: string;
  readonly allowedHosts: readonly string[];
}

export interface InstallerCommandRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly tier: InstallTier;
  readonly timeoutMs: number;
  readonly role: "kernel_installer" | "install_script" | "red_team_probe";
  readonly limits: {
    readonly memoryBytes: number;
    readonly activeProcessLimit: number;
  };
  readonly environmentId: string;
}

export interface InstallerCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Structural port over Task 040 `WindowsJobManager.runCommand`. */
export interface InstallerJobRunner {
  runCommand(request: InstallerCommandRequest): Promise<InstallerCommandResult>;
}

export interface LifecycleScripts {
  readonly preinstall?: string;
  readonly install?: string;
  readonly postinstall?: string;
}

export interface PackageVersionMetadata {
  readonly name: string;
  readonly version: string;
  readonly publishedAt: string;
  readonly license: string | null;
  readonly integrity: string;
  readonly tarballUrl: string | null;
  readonly scripts: LifecycleScripts;
  readonly packageDir?: string;
}

export interface PackageMetadataSource {
  getVersion(name: string, version: string): PackageVersionMetadata | null;
  listVersions?(name: string): readonly PackageVersionMetadata[];
}

export interface AdvisoryRecord {
  readonly id: string;
  readonly packageName: string;
  readonly severity: "critical" | "high" | "moderate" | "low" | "unknown";
  readonly range: string;
}

export interface AdvisorySource {
  lookup(name: string, version: string): readonly AdvisoryRecord[];
}

export interface LicensePolicy {
  readonly allowed: readonly string[];
}

export interface DependencyIntent {
  readonly taskId: string;
  readonly packageName: string;
  readonly range: string;
  readonly reason: string;
  readonly version?: string;
  readonly waivedAdvisories?: readonly string[];
}

export type TyposquatReason = "edit-distance" | "homoglyph" | "delimiter" | "scope-confusion";

export interface TyposquatMatch {
  readonly requested: string;
  readonly similarTo: string;
  readonly reason: TyposquatReason;
  readonly distance: number | null;
}

export interface AgeCheck {
  readonly publishedAt: string | null;
  readonly ageHours: number | null;
  readonly minAgeHours: number;
  readonly held: boolean;
}

export interface VulnerabilityFinding {
  readonly id: string;
  readonly severity: string;
  readonly waived: boolean;
  readonly blocking: boolean;
}

export type LicenseStatus = "allowed" | "copyleft" | "unknown" | "missing" | "disallowed";

export interface LicenseCheck {
  readonly expression: string | null;
  readonly status: LicenseStatus;
  readonly flagged: boolean;
}

export interface SupplyChainVetReport {
  readonly packageName: string;
  readonly version: string | null;
  readonly range: string;
  readonly decision: "allow" | "hold" | "deny";
  readonly age: AgeCheck;
  readonly vulnerabilities: readonly VulnerabilityFinding[];
  readonly cveBlocked: boolean;
  readonly typosquat: TyposquatMatch | null;
  readonly license: LicenseCheck;
  readonly reasons: readonly string[];
}

export interface InstallScriptApprovalRequired {
  readonly type: "InstallScriptApprovalRequired";
  readonly inboxType: "Approval";
  readonly packageName: string;
  readonly version: string;
  readonly packageAtVersion: string;
  readonly scripts: LifecycleScripts;
  readonly scriptPreview: string;
  readonly prompt: "Approve this version once";
  readonly actions: readonly ["Approve this version once", "Deny"];
  readonly message: string;
}

export interface LockfilePackageRecord {
  readonly name: string;
  readonly version: string;
  readonly integrity: string | null;
  readonly tarballUrl: string | null;
  readonly local: boolean;
}

export interface LockfileIntegrityFailure {
  readonly name: string;
  readonly version: string;
  readonly code: "missing_sha512" | "rogue_tarball_url" | "integrity_mismatch";
  readonly detail: string;
}

export interface LockfileIntegrityReport {
  readonly ok: boolean;
  readonly lockfilePath: string;
  readonly manager: PackageManager;
  readonly packages: readonly LockfilePackageRecord[];
  readonly failures: readonly LockfileIntegrityFailure[];
}

export interface IntegrityCheckOptions {
  readonly allowedHosts?: readonly string[];
  readonly bytesFor?: (record: LockfilePackageRecord) => Buffer | null;
}

export interface MergedDependencyUpdate {
  readonly packageName: string;
  readonly range: string;
  readonly taskIds: readonly string[];
  readonly reasons: readonly string[];
}

export interface DependencyConflict {
  readonly packageName: string;
  readonly ranges: readonly {
    readonly taskId: string;
    readonly range: string;
    readonly reason: string;
  }[];
}

export interface DependencyReconciliation {
  readonly updates: readonly MergedDependencyUpdate[];
  readonly conflicts: readonly DependencyConflict[];
}

export interface InstalledPackageReceipt {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly license: string | null;
  readonly installScriptsRan: boolean;
}

export interface DependencyAuditReceipt {
  readonly installed: readonly InstalledPackageReceipt[];
  readonly scriptsRan: boolean;
  readonly offline: boolean;
  readonly networkEgress: boolean;
  readonly storeDir: string;
  readonly storeRealigned: boolean;
  readonly storeWarning: string | null;
  readonly tier: InstallTier;
  readonly manager: PackageManager;
  readonly lockfilePath: string;
  readonly commands: readonly string[];
  readonly nodeModulesReadOnly: boolean;
}

export type InstallOutcome =
  | { readonly status: "installed"; readonly receipt: DependencyAuditReceipt }
  | { readonly status: "approval_required"; readonly cards: readonly InstallScriptApprovalRequired[] }
  | { readonly status: "vet_blocked"; readonly report: SupplyChainVetReport }
  | { readonly status: "conflict"; readonly reconciliation: DependencyReconciliation };

export interface LockedInstallRequest {
  readonly lockfilePath: string;
  readonly manifests?: readonly PackageVersionMetadata[];
}

export interface AddDependencyRequest {
  readonly intent: DependencyIntent;
  readonly lockfilePath: string;
  readonly packageJsonPath: string;
}

export interface ApplyReconciledRequest {
  readonly intents: readonly DependencyIntent[];
  readonly lockfilePath: string;
  readonly packageJsonPath: string;
}

export interface StoreAlignment {
  readonly storeDir: string;
  readonly realigned: boolean;
  readonly warning: string | null;
}

export interface KernelPackageInstallerOptions {
  readonly actor: InstallActor;
  readonly tier: SandboxTier;
  readonly worktreePath: string;
  readonly proxy: KernelInstallerProxy;
  readonly jobRunner: InstallerJobRunner;
  readonly metadata: PackageMetadataSource;
  readonly advisories?: AdvisorySource;
  readonly storeDir: string;
  readonly allowBuilds?: readonly string[];
  readonly licensePolicy?: LicensePolicy;
  readonly minAgeHours?: number;
  readonly now?: () => Date;
  readonly diskLane?: DiskLane;
  readonly secretRoots?: readonly string[];
  readonly volumeOf?: (filePath: string) => string;
  readonly attemptHome?: string;
  readonly environmentId?: string;
  readonly popularPackages?: readonly string[];
  readonly createStoreDirectory?: boolean;
}

export interface DiskLane {
  run<T>(work: () => Promise<T>): Promise<T>;
}
