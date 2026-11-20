export {
  BIND_HOST,
  HEADER_READ_TIMEOUT_MS,
  MAX_HEADER_BYTES,
  PORT_LEASE_MAX,
  PORT_LEASE_MIN,
} from "./types.js";
export type {
  AllowlistProxyServerOptions,
  AllowedTestEndpoint,
  AttemptFenceReason,
  AttemptRegistration,
  AttemptResourceLimits,
  AuditDecision,
  HostResolver,
  NetworkAuditEvent,
  NetworkPolicyProfile,
  PortLease,
  ProxyDiagnosticsSnapshot,
  ProxyTokenHandle,
  ResolvedAddress,
  SecretFinding,
  SecretRedactor,
  StructuredLogger,
  StructuredLoggerContext,
  WrappedVendorId,
} from "./types.js";
export { ProxyAuditLog } from "./audit-log.js";
export { canonicalIp, everyAddressPermitted, isPublicIp } from "./ip-policy.js";
export { CapturingStructuredLogger } from "./logger.js";
export type { CapturedLogLine } from "./logger.js";
export {
  DEFAULT_ATTEMPT_LIMITS,
  KERNEL_REGISTRY_HOSTS,
  RESEARCHER_DOCUMENTATION_HOSTS,
  WRAPPED_VENDOR_HOSTS,
  evaluateProfileAccess,
  hostMatches,
  normalizeHostname,
  vendorOwnsHost,
} from "./profiles.js";
export type { ProfileAccessDecision, ProfileAccessRequest } from "./profiles.js";
export { resolveHostDefault } from "./resolve-host.js";
export { CanaryVaultSecretRedactor, findBuiltinSecretSpans } from "./secret-scan.js";
export { AllowlistProxyServer, ProxyConfigError } from "./allowlist-proxy-server.js";
