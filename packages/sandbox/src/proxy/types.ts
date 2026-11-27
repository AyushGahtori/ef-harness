/**
 * Contracts for the loopback allowlisting proxy.
 * `SecretRedactor` and `StructuredLogger` match the Task 011 method surface.
 * `PortLease` matches the Task 014 `global.db.port_leases` row.
 */

export const BIND_HOST = "127.0.0.1" as const;
export const HEADER_READ_TIMEOUT_MS = 5_000;
export const MAX_HEADER_BYTES = 16 * 1024;
export const PORT_LEASE_MIN = 41_000;
export const PORT_LEASE_MAX = 48_999;

export type NetworkPolicyProfile =
  "coding_worker" | "verifier_test" | "kernel_installer" | "researcher" | "wrapped_vendor";

export type WrappedVendorId =
  "openai" | "chatgpt" | "anthropic" | "github_copilot" | "cursor" | "google";

export type AttemptFenceReason = "fenced" | "paused" | "completed";

export type AuditDecision = "allow" | "deny";

export interface PortLease {
  readonly port: number;
  readonly projectId: string;
  readonly environment: string;
  readonly leasedAt: number;
  readonly expiresAt: number | null;
}

export interface AllowedTestEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface AttemptResourceLimits {
  readonly maxConcurrentTunnels: number;
  readonly maxResponseBytes: number;
  readonly connectTimeoutMs: number;
  readonly idleTimeoutMs: number;
}

export interface AttemptRegistration {
  readonly attemptId: string;
  readonly profile: NetworkPolicyProfile;
  readonly vendor?: WrappedVendorId;
  readonly allowedTestEndpoints?: readonly AllowedTestEndpoint[];
  readonly documentationHosts?: readonly string[];
  readonly corporateRegistries?: readonly string[];
  readonly limits?: Partial<AttemptResourceLimits>;
}

export interface ProxyTokenHandle {
  readonly attemptId: string;
  readonly profile: NetworkPolicyProfile;
  readonly token: string;
  readonly proxyAuthorization: string;
}

export interface SecretFinding {
  readonly start: number;
  readonly end: number;
  readonly label: string;
  readonly source?: "vault" | "pattern";
}

export interface SecretRedactor {
  redact(text: string): string;
  scanForSecrets(text: string): readonly SecretFinding[];
}

export interface StructuredLoggerContext {
  readonly attemptId?: string;
  readonly component?: string;
}

export interface StructuredLogger {
  info(message: string, fields?: unknown): void;
  warn(message: string, fields?: unknown): void;
  error(message: string, fields?: unknown): void;
  withContext?(context: StructuredLoggerContext): StructuredLogger;
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type HostResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export interface NetworkAuditEvent {
  readonly at: string;
  readonly attemptId: string;
  readonly profile: NetworkPolicyProfile | "unknown";
  readonly method: string;
  readonly host: string;
  readonly port: number;
  readonly decision: AuditDecision;
  readonly reason: string;
  readonly bytesIn: number;
  readonly bytesOut: number;
  readonly query: string;
  readonly authorization: string;
}

export interface ProxyDiagnosticsSnapshot {
  readonly deniedCount: number;
  readonly deniedByAttempt: Readonly<Record<string, number>>;
  readonly deniedByReason: Readonly<Record<string, number>>;
}

export interface ProxyFetchInit {
  readonly method?: "GET" | "HEAD";
  readonly profile?: NetworkPolicyProfile;
  readonly attemptId?: string;
  readonly pinnedAddress?: string;
  readonly servername?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

export interface ProxyFetchResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly finalUrl: string;
}

export interface AllowlistProxyServerOptions {
  readonly portLease: PortLease;
  readonly logger?: StructuredLogger;
  readonly redactor?: SecretRedactor;
  readonly researcherDocumentationHosts?: readonly string[];
  /**
   * Production must leave this empty. When set, a resolved address may be
   * private only if it appears in this exact list. Used so tests can reach a
   * local mock upstream. Refused when NODE_ENV is production.
   */
  readonly testOnlyPrivateIpAllowlist?: readonly string[];
  /** Defaults to true. Refused false when NODE_ENV is production. */
  readonly rejectUnauthorized?: boolean;
  readonly headerReadTimeoutMs?: number;
  readonly maxHeaderBytes?: number;
  readonly resolveHost?: HostResolver;
  readonly now?: () => number;
}
