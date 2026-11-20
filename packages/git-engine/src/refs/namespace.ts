import { InvalidRefLeaseArgumentError, NamespaceViolationError } from "./errors.js";

export const ZERO_OID = "0000000000000000000000000000000000000000";

const SHA_RE = /^[0-9a-f]{40}$/;
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LANDING_BRAND: unique symbol = Symbol("ef.landingAuthorization");

export type HarnessRefKind =
  | "integration"
  | "feature"
  | "attempt"
  | "sweep"
  | "snapshot"
  | "checkpoint"
  | "harness_state";

export type RefWriteTarget =
  | {
      readonly zone: "harness";
      readonly kind: HarnessRefKind;
      readonly leasable: boolean;
      readonly ref: string;
    }
  | {
      readonly zone: "landing";
      readonly ref: string;
    };

export interface LandingAuthorization {
  readonly purpose: "user_consented_landing";
  readonly ref: string;
  readonly consentedBy: string;
  readonly expiresAtMs: number;
  readonly [LANDING_BRAND]: true;
}

export function isSha(value: string): boolean {
  return SHA_RE.test(value);
}

export function normalizeSha(value: string, label: string): string {
  const sha = value.trim().toLowerCase();
  if (!isSha(sha)) {
    throw new InvalidRefLeaseArgumentError(`${label} must be a 40-character hexadecimal SHA.`);
  }
  return sha;
}

export function normalizeExpectedSha(value: string): string {
  const sha = value.trim().toLowerCase();
  if (sha === ZERO_OID || isSha(sha)) return sha;
  throw new InvalidRefLeaseArgumentError(
    "expectedOldSha must be a 40-character hexadecimal SHA or the zero OID.",
  );
}

export function issueLandingAuthorization(input: {
  readonly ref: string;
  readonly consentedBy: string;
  readonly expiresAtMs: number;
  readonly userConsent: true;
  readonly developerBaseRef?: string;
}): LandingAuthorization {
  if (input.userConsent !== true) {
    throw new InvalidRefLeaseArgumentError("Landing authorization requires explicit user consent.");
  }
  if (!Number.isFinite(input.expiresAtMs)) {
    throw new InvalidRefLeaseArgumentError("Landing authorization expiry must be a finite timestamp.");
  }
  const consentedBy = input.consentedBy.trim();
  if (!consentedBy || /[\r\n\0]/.test(consentedBy)) {
    throw new InvalidRefLeaseArgumentError("Landing authorization needs a consented-by identity.");
  }
  const developerBaseRef = input.developerBaseRef ?? "refs/heads/main";
  if (!isDeveloperBaseRef(input.ref, developerBaseRef)) {
    throw new NamespaceViolationError(
      input.ref,
      `Landing authorization cannot be issued for ${input.ref}.`,
    );
  }
  return {
    purpose: "user_consented_landing",
    ref: input.ref,
    consentedBy,
    expiresAtMs: input.expiresAtMs,
    [LANDING_BRAND]: true,
  };
}

export function isLandingAuthorization(value: unknown): value is LandingAuthorization {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LandingAuthorization>;
  return (
    record.purpose === "user_consented_landing" &&
    typeof record.ref === "string" &&
    typeof record.consentedBy === "string" &&
    typeof record.expiresAtMs === "number" &&
    record[LANDING_BRAND] === true
  );
}

export function classifyAutomatedWrite(
  ref: string,
  developerBaseRef: string,
  authorization: LandingAuthorization | undefined,
  nowMs: number,
): RefWriteTarget {
  if (!isSafeRef(ref)) {
    throw new NamespaceViolationError(ref);
  }
  if (isDeveloperBaseRef(ref, developerBaseRef)) {
    assertLandingAuthorization(ref, authorization, nowMs);
    return { zone: "landing", ref };
  }
  const kind = harnessKind(ref);
  if (!kind) {
    throw new NamespaceViolationError(ref);
  }
  return {
    zone: "harness",
    kind,
    leasable: kind === "integration" || kind === "feature" || kind === "sweep",
    ref,
  };
}

export function assertLeasableRef(ref: string): RefWriteTarget & { readonly zone: "harness" } {
  if (!isSafeRef(ref)) {
    throw new NamespaceViolationError(ref);
  }
  if (isDeveloperBaseRef(ref, "refs/heads/main")) {
    throw new NamespaceViolationError(
      ref,
      `Ref ${ref} cannot take a harness ref lease. Landing uses the user-consented landing API.`,
    );
  }
  const kind = harnessKind(ref);
  if (!kind || (kind !== "integration" && kind !== "feature" && kind !== "sweep")) {
    throw new InvalidRefLeaseArgumentError(
      `Ref leases cover refs/heads/harness/integration, refs/heads/harness/f/*, and refs/heads/harness/s/* only. Received ${ref}.`,
    );
  }
  return { zone: "harness", kind, leasable: true, ref };
}

export function assertFeatureRef(ref: string): void {
  if (!isSafeRef(ref) || harnessKind(ref) !== "feature") {
    throw new InvalidRefLeaseArgumentError(
      `Leaf commits squash only onto refs/heads/harness/f/<feature>. Received ${ref}.`,
    );
  }
}

export function assertIntegrationRef(ref: string): void {
  if (ref !== "refs/heads/harness/integration") {
    throw new InvalidRefLeaseArgumentError(
      `Feature merges land only on refs/heads/harness/integration. Received ${ref}.`,
    );
  }
}

export function assertAttemptRef(ref: string): void {
  if (!isSafeRef(ref) || harnessKind(ref) !== "attempt") {
    throw new InvalidRefLeaseArgumentError(
      `Attempt branch deletion accepts only refs/heads/harness/t/<task>/<attempt>. Received ${ref}.`,
    );
  }
}

export function isProtectedWipRef(ref: string): boolean {
  const normalized = ref.trim().replaceAll("\\", "/");
  const short = normalized.startsWith("refs/heads/")
    ? normalized.slice("refs/heads/".length)
    : normalized;
  const pieces = short.split("/");
  return pieces.some((piece) => piece.toLowerCase() === "wip");
}

function assertLandingAuthorization(
  ref: string,
  authorization: LandingAuthorization | undefined,
  nowMs: number,
): void {
  if (!authorization || !isLandingAuthorization(authorization)) {
    throw new NamespaceViolationError(ref);
  }
  if (authorization.ref.toLowerCase() !== ref.toLowerCase()) {
    throw new NamespaceViolationError(
      ref,
      `Landing authorization was issued for ${authorization.ref}, not ${ref}.`,
    );
  }
  if (nowMs >= authorization.expiresAtMs) {
    throw new NamespaceViolationError(ref, `Landing authorization for ${ref} has expired.`);
  }
}

function isDeveloperBaseRef(ref: string, developerBaseRef: string): boolean {
  const folded = ref.toLowerCase();
  return folded === "refs/heads/main" || folded === developerBaseRef.toLowerCase();
}

function harnessKind(ref: string): HarnessRefKind | null {
  if (ref === "refs/heads/harness/integration") return "integration";
  if (ref === "refs/heads/harness-state") return "harness_state";
  if (matchHead(ref, "harness/f")) return "feature";
  if (matchHead(ref, "harness/s")) return "sweep";
  if (matchAttempt(ref)) return "attempt";
  if (matchLoose(ref, "refs/harness/snapshots/")) return "snapshot";
  if (matchLoose(ref, "refs/harness/checkpoints/")) return "checkpoint";
  return null;
}

function matchHead(ref: string, prefix: string): boolean {
  const lead = `refs/heads/${prefix}/`;
  if (!ref.startsWith(lead)) return false;
  const rest = ref.slice(lead.length);
  return SEGMENT_RE.test(rest);
}

function matchAttempt(ref: string): boolean {
  const lead = "refs/heads/harness/t/";
  if (!ref.startsWith(lead)) return false;
  const parts = ref.slice(lead.length).split("/");
  return parts.length === 2 && parts.every((part) => SEGMENT_RE.test(part));
}

function matchLoose(ref: string, prefix: string): boolean {
  if (!ref.startsWith(prefix)) return false;
  const parts = ref.slice(prefix.length).split("/");
  return parts.length > 0 && parts.every((part) => SEGMENT_RE.test(part));
}

function isSafeRef(ref: string): boolean {
  if (ref.length === 0 || ref.length > 300) return false;
  if (!ref.startsWith("refs/")) return false;
  if (ref.includes("//") || ref.endsWith("/") || ref.endsWith(".") || ref.endsWith(".lock")) {
    return false;
  }
  for (const char of ref) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return false;
    if ("\\~^:?*[]{}@".includes(char)) return false;
  }
  return ref.split("/").every((part) => part !== "." && part !== ".." && !part.endsWith(".lock"));
}
