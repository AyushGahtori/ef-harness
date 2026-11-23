export const PRIORITY_CLASS_WEIGHTS = {
  interactive: 8,
  foreground: 4,
  background: 2,
  batch: 1,
} as const;

export type PriorityClass = keyof typeof PRIORITY_CLASS_WEIGHTS;

export type GrantCurrency = "micro_usd" | "ppm";

export type GrantState = "issued" | "deposited" | "closed" | "expired";

export type ExecutionRole = "verifier" | "worker" | "background" | "batch";

export const EXECUTION_ROLE_PRECEDENCE: readonly ExecutionRole[] = [
  "verifier",
  "worker",
  "background",
  "batch",
] as const;

export interface BrokerRequest {
  readonly requestId: string;
  readonly projectId: string;
  readonly connectionId?: string;
  readonly priorityClass: PriorityClass;
  readonly enqueuedAtMs: number;
  readonly role?: string;
}

export interface ExecutionSlotRequest extends BrokerRequest {
  readonly executionRole: ExecutionRole;
  readonly needsHeavyLane: boolean;
}

export interface GrantLeaseRow {
  readonly grantId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly currency: GrantCurrency;
  readonly grantedAmount: number;
  consumedAmount: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  state: GrantState;
}

export interface PortLeaseRow {
  readonly port: number;
  readonly projectId: string;
  readonly environment: string;
  readonly leasedAtMs: number;
  readonly expiresAtMs: number | null;
}

export interface MachineCapacityLimits {
  readonly pool2WarmSlots: number;
  readonly heavyLanePermits: number;
  readonly sessionProcessCap: number;
}

export interface BrokerPopoverLine {
  readonly connectionId: string;
  readonly summary: string;
}

export interface BrokerPopoverSnapshot {
  readonly foregroundProjectId: string | null;
  readonly connectionLines: readonly BrokerPopoverLine[];
  readonly machineRunSlots: string;
}

export interface WfqServiceSample {
  readonly priorityClass: PriorityClass;
  readonly dispatches: number;
}

export interface GrantIssueInput {
  readonly grantId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly currency: GrantCurrency;
  readonly requestedAmount: number;
  readonly nowMs: number;
}

export interface GrantIssueResult {
  readonly grantId: string;
  readonly grantedAmount: number;
  readonly partial: boolean;
}

export interface ConnectionWindowHeadroom {
  readonly connectionId: string;
  readonly currency: GrantCurrency;
  readonly remainingUnits: number;
}

export interface PacingCwndPort {
  getCwnd(connectionId: string): number;
}

export interface BrokerGrantIssuerPort {
  issueGrant(input: {
    grantId: string;
    projectId: string;
    connectionId: string;
    currency: string;
    units: number;
    concurrency: number;
    priorityClass: PriorityClass;
    issuedAt: number;
    expiresAt: number;
  }): void;
  expireUnreportedGrants(nowMs: number): number;
}

export interface GlobalDbGrantStore {
  beginImmediate<T>(fn: () => T): T;
  getPoolRemaining(connectionId: string, currency: GrantCurrency): number;
  setPoolRemaining(connectionId: string, currency: GrantCurrency, units: number): void;
  insertGrant(row: GrantLeaseRow): void;
  listOpenGrants(connectionId: string, currency: GrantCurrency): GrantLeaseRow[];
  updateGrant(row: GrantLeaseRow): void;
  reclaimExpired(nowMs: number): number;
  getGrant(grantId: string): GrantLeaseRow | undefined;
}

export const GRANT_TTL_MS = 10 * 60 * 1000;
export const PORT_LEASE_MIN = 41_000;
export const PORT_LEASE_MAX = 48_999;