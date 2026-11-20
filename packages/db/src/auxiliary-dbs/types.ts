export const PROJECT_STATUSES = [
  "ok",
  "needs_migration",
  "needs_repair",
  "offline",
  "removed",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TELEMETRY_KINDS = ["progress", "tokens", "heartbeat", "tool", "metric"] as const;

export type TelemetryKind = (typeof TELEMETRY_KINDS)[number];

export const SYMBOL_KINDS = ["function", "class", "type", "const", "component", "route"] as const;

export type SymbolKind = (typeof SYMBOL_KINDS)[number];

export const GRANT_PRIORITIES = ["interactive", "foreground", "background", "batch"] as const;

export type GrantPriority = (typeof GRANT_PRIORITIES)[number];

export const GRANT_STATES = ["issued", "deposited", "closed", "expired"] as const;

export type GrantState = (typeof GRANT_STATES)[number];

export const PIN_HOLDER_KINDS = ["project", "backup", "research", "export", "pending"] as const;

export type PinHolderKind = (typeof PIN_HOLDER_KINDS)[number];

export interface AuxiliaryLogEvent {
  readonly level: "warn";
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AuxiliaryLogger {
  warn(event: Omit<AuxiliaryLogEvent, "level">): void;
}

export interface DataRootPrivacy {
  readonly insideLocalAppData: boolean;
  readonly worldReadable: boolean;
  readonly warning: string | null;
}

export interface ProcessIdentity {
  readonly pid: number;
  readonly processStartTime: number;
  readonly hostname: string;
}

export interface BrokerOwner {
  readonly pid: number;
  readonly processStartTime: number;
  readonly epoch: number;
  readonly hostname: string;
  readonly acquiredAt: number;
  readonly role: "broker";
}

export interface ProjectRecord {
  readonly id: string;
  readonly path: string;
  readonly displayName: string;
  readonly schemaVersion: number;
  readonly status: ProjectStatus;
  readonly lastOpenedAt: number | null;
  readonly lastSeenAt: number | null;
}

export interface RegisterProjectInput {
  readonly id: string;
  readonly path: string;
  readonly displayName: string;
  readonly schemaVersion: number;
  readonly status?: ProjectStatus;
  readonly lastOpenedAt?: number | null;
  readonly lastSeenAt?: number | null;
}

export interface MachineProfileEntry {
  readonly key: string;
  readonly value: string;
  readonly measuredAt: number;
}

export interface FootprintEntry {
  readonly consumer: string;
  readonly project: string;
  readonly p50Mb: number;
  readonly p95Mb: number;
  readonly samples: number;
  readonly updatedAt: number;
}

export interface PortLease {
  readonly port: number;
  readonly projectId: string;
  readonly environment: string;
  readonly leasedAt: number;
  readonly expiresAt: number | null;
}

export interface LeasePortInput {
  readonly projectId: string;
  readonly environment: string;
  readonly leasedAt: number;
  readonly port?: number;
  readonly expiresAt?: number | null;
}

export interface ResearchCacheKey {
  readonly packageName: string;
  readonly versionRange: string;
  readonly docUrl: string;
}

export interface ResearchCacheEntry extends ResearchCacheKey {
  readonly pageVersion: string | null;
  readonly artifactHash: string;
  readonly fetchedAt: number;
  readonly expiresAt: number;
}

export interface ResearchCacheWrite {
  readonly packageName: string;
  readonly versionRange: string;
  readonly docUrl: string;
  readonly pageVersion?: string | null;
  readonly artifactHash: string;
  readonly fetchedAt: number;
}

export interface ResearchCacheFilter {
  readonly packageName?: string;
  readonly versionRange?: string;
  readonly docUrl?: string;
}

export interface ConnectionInput {
  readonly id: string;
  readonly provider: string;
  readonly route: string;
  readonly plan?: string | null;
  readonly vaultRef?: string | null;
  readonly currency: string;
  readonly scale: number;
  readonly enabled?: boolean;
  readonly createdAt: number;
}

export interface ConnectionRecord {
  readonly id: string;
  readonly provider: string;
  readonly route: string;
  readonly plan: string | null;
  readonly vaultRef: string | null;
  readonly currency: string;
  readonly scale: number;
  readonly enabled: boolean;
  readonly createdAt: number;
}

export interface CasPinInput {
  readonly hash: string;
  readonly holderKind: PinHolderKind;
  readonly holderId: string;
  readonly pinnedAt: number;
}

export type CasPinRecord = CasPinInput;

export interface GrantInput {
  readonly id: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly currency: string;
  readonly units: number;
  readonly concurrency?: number;
  readonly priorityClass: GrantPriority;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly state?: GrantState;
  readonly usedUnits?: number | null;
  readonly unknownUnits?: number | null;
  readonly closedAt?: number | null;
}

export interface GrantRecord {
  readonly id: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly currency: string;
  readonly units: number;
  readonly concurrency: number;
  readonly priorityClass: GrantPriority;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly state: GrantState;
  readonly usedUnits: number | null;
  readonly unknownUnits: number | null;
  readonly closedAt: number | null;
}

export interface GlobalConnectionSettings {
  readonly journalMode: string;
  readonly synchronous: string;
  readonly foreignKeys: boolean;
  readonly secureDelete: boolean;
  readonly userVersion: number;
  readonly busyTimeoutMs: number;
}

export interface TelemetryEventInput {
  readonly attempt?: string | null;
  readonly ts: number;
  readonly kind: TelemetryKind;
  readonly data: unknown;
}

export interface TelemetryRecord {
  readonly id: number;
  readonly attempt: string | null;
  readonly ts: number;
  readonly kind: TelemetryKind;
  readonly data: unknown;
}

export interface TelemetryEnqueueResult {
  readonly accepted: boolean;
  readonly dropped: number;
}

export interface TelemetryStats {
  readonly queued: number;
  readonly dropped: number;
  readonly flushed: number;
  readonly flushTransactions: number;
}

export interface IndexedCommit {
  readonly commitSha: string;
  readonly builtAt: number;
  readonly files: number;
}

export interface CommitFile {
  readonly commitSha: string;
  readonly path: string;
  readonly fileHash: string;
}

export interface CodeSymbol {
  readonly fileHash: string;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly line: number;
  readonly signature: string | null;
  readonly exported: boolean;
}

export interface CodeSymbolInput {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly line: number;
  readonly signature?: string | null;
  readonly exported: boolean;
}

export interface CodeRef {
  readonly fileHash: string;
  readonly name: string;
  readonly line: number;
}

export interface CodeRefInput {
  readonly name: string;
  readonly line: number;
}

export interface FileRank {
  readonly commitSha: string;
  readonly path: string;
  readonly score: number;
}
