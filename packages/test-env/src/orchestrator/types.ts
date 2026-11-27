export const PORT_RANGE_MIN = 41000;
export const PORT_RANGE_MAX = 48999;
export const DEFAULT_READINESS_TIMEOUT_MS = 30_000;
export const IGNORED_APP_PORT = 3000;
export const ENV_DIRECTORY_NAME = ".ef-harness-env";

export const ENVIRONMENT_KINDS = ["attempt", "verifier", "migration", "preview"] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export const PROVISIONING_TIERS = [0, 1, 2, 3] as const;
export type ProvisioningTier = (typeof PROVISIONING_TIERS)[number];

export const SERVICE_NAMES = [
  "sqlite",
  "postgres",
  "redis",
  "mail",
  "oauth",
  "stripe",
  "s3",
  "http_replay",
] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export const SERVICE_PORT_KEYS: Readonly<Record<ServiceName, string | null>> = {
  sqlite: null,
  postgres: "pg",
  redis: "redis",
  mail: "smtp",
  oauth: "oauth",
  stripe: "stripe",
  s3: "s3",
  http_replay: "http_replay",
};

export interface AppSpec {
  readonly start: string;
  readonly ready: string;
  readonly cwd?: string;
  readonly memoryCeilingMb?: number;
}

export interface ServiceSpec {
  readonly start: string;
  readonly ready: string;
  readonly cwd?: string;
  readonly memoryCeilingMb?: number;
}

export interface EnvironmentManifest {
  readonly services: readonly ServiceName[];
  readonly env: Readonly<Record<string, string>>;
  readonly app?: AppSpec;
  readonly extraServices?: Readonly<Record<string, ServiceSpec>>;
  readonly tier?: ProvisioningTier;
}

export interface EnvironmentDirectories {
  readonly root: string;
  readonly temp: string;
  readonly upload: string;
  readonly buildOutput: string;
}

export interface JobLimits {
  readonly killOnJobClose: true;
  readonly jobMemoryBytes?: number;
  readonly activeProcessLimit?: number;
  readonly cpuRatePercent?: number;
}

export interface JobAccounting {
  readonly activeProcesses: number;
  readonly peakMemoryBytes: number;
  readonly currentMemoryBytes: number;
  readonly userCpuMs: number;
  readonly kernelCpuMs: number;
}

export type JobKind = "project-service" | "environment" | "attempt" | "command";

export interface JobHandle {
  readonly name: string;
  readonly kind: JobKind;
}

export interface CreateJobRequest {
  readonly name: string;
  readonly kind: JobKind;
  readonly parentName?: string;
  readonly limits: JobLimits;
}

export interface EnvProcessRecord {
  readonly pid: number;
  readonly startTime: number;
  readonly environment: string;
  readonly role: string;
  readonly port: number | null;
  readonly jobName: string | null;
}

export interface OrphanSkip {
  readonly record: EnvProcessRecord;
  readonly reason: string;
  readonly removeRecord: boolean;
}

export interface OrphanReconcileReport {
  readonly terminated: readonly EnvProcessRecord[];
  readonly skipped: readonly OrphanSkip[];
}

export interface WindowsJobManager {
  createJob(request: CreateJobRequest): JobHandle;
  assignProcess(job: JobHandle, pid: number): void;
  queryJobAccounting(job: JobHandle): JobAccounting;
  terminateJob(job: JobHandle): Promise<void>;
  reconcileOrphanedProcesses(): Promise<OrphanReconcileReport>;
}

export interface PortLeaseRecord {
  readonly port: number;
  readonly project: string;
  readonly environment: string;
  readonly leasedAt: number;
  readonly expiresAt: number | null;
}

export interface LeasePortInput {
  readonly projectId: string;
  readonly environmentId: string;
  readonly leasedAt: number;
  readonly expiresAt: number | null;
  readonly skip: ReadonlySet<number>;
}

export interface PortLeaseStore {
  leaseNext(input: LeasePortInput): number | null;
  release(port: number, environmentId: string): boolean;
  releaseEnvironment(environmentId: string): number[];
  list(): PortLeaseRecord[];
  releaseLeasesForDeadEnvironments(liveEnvironmentIds: ReadonlySet<string>): number[];
}

export interface EnvProcessStore {
  insert(record: EnvProcessRecord): void;
  delete(pid: number, startTime: number): void;
  deleteEnvironment(environmentId: string): void;
  list(): EnvProcessRecord[];
  listByEnvironment(environmentId: string): EnvProcessRecord[];
}

export interface ServiceProvisionContext {
  readonly projectId: string;
  readonly environmentId: string;
  readonly kind: EnvironmentKind;
  readonly tier: ProvisioningTier;
  readonly host: string;
  readonly dbName: string;
  readonly recipientDomain: string;
  readonly port: number | null;
  readonly portKey: string | null;
  readonly directories: EnvironmentDirectories;
  readonly worktreePath: string;
  readonly baseCommit: string;
}

export interface ServiceProvisionResult {
  readonly namespaceId: string;
  readonly dbName: string;
  readonly url: string | null;
}

export interface ServiceProvider {
  readonly serviceName: string;
  provision(context: ServiceProvisionContext): Promise<ServiceProvisionResult>;
  resetData(context: ServiceProvisionContext): Promise<void>;
  destroy(context: ServiceProvisionContext): Promise<void>;
  start?(context: ServiceProvisionContext): Promise<{ readonly url: string }>;
}

export interface EnvironmentAdmissionRequest {
  readonly projectId: string;
  readonly kind: EnvironmentKind;
  readonly tier: ProvisioningTier;
  readonly services: readonly string[];
  readonly stateful: boolean;
}

export interface EnvironmentAdmissionDecision {
  readonly admitted: boolean;
  readonly reason: string;
}

export interface HardwareAdmissionGate {
  admitEnvironment(
    request: EnvironmentAdmissionRequest,
  ): Promise<EnvironmentAdmissionDecision> | EnvironmentAdmissionDecision;
}

export interface SecretVault {
  get(name: string): string | undefined;
  entries(): Readonly<Record<string, string>>;
}

export interface EnvironmentHandle {
  readonly id: string;
  readonly shortId: string;
  readonly kind: EnvironmentKind;
  readonly tier: ProvisioningTier;
  readonly host: string;
  readonly baseCommit: string;
  readonly worktreePath: string;
  readonly dbName: string;
  readonly recipientDomain: string;
  readonly ports: Readonly<Record<string, number>>;
  readonly urls: Readonly<Record<string, string>>;
  readonly directories: EnvironmentDirectories;
  vars(): Readonly<Record<string, string>>;
  start_app(): Promise<void>;
  start_service(name: string): Promise<string>;
  reset_data(): Promise<void>;
  destroy(): Promise<void>;
}

export interface StartupReconcileReport {
  readonly releasedPorts: readonly number[];
  readonly removedProcessRows: number;
  readonly removedDirectories: readonly string[];
  readonly orphanReport: OrphanReconcileReport;
}

export const admitAllEnvironments: HardwareAdmissionGate = {
  admitEnvironment() {
    return { admitted: true, reason: "admitted" };
  },
};
