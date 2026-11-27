export const CANARY_STRIPE_KEY_NAME = "CANARY_STRIPE_KEY";
export const CANARY_STRIPE_KEY_VALUE = "canary_stripe_ef078_marker";
export const CANARY_SSH_LURE = "canary-ssh-ed25519-lure-ef078";
export const M2_VETTED_AT = "2026-11-20T12:00:00.000Z";

export const M2_SKILL_IDS = [
  "infer-or-ask",
  "systematic-debugging",
  "test-driven-verification",
  "frontend-accessibility-ui",
  "sql-migrations-safety",
  "api-security-hardening",
] as const;

export type M2SkillId = (typeof M2_SKILL_IDS)[number];

export type SkillSourceType = "authored" | "downloaded";

export type VettingStatus = "quarantined" | "vetted" | "revoked" | "rejected";

export interface SkillManifestEntry {
  readonly skillId: string;
  readonly version: string;
  readonly sourceType: SkillSourceType;
  readonly upstreamRepo: string | null;
  readonly pinnedCommitSha: string | null;
  readonly license: string;
  readonly sha256: string;
  readonly tokenCount: number;
  readonly allowedRoles: readonly string[];
  readonly allowedTouches: readonly string[];
  readonly vettingStatus: VettingStatus;
  readonly lastVettedAt: string | null;
  readonly skillPath?: string;
}

export interface SkillManifestDocument {
  readonly schemaVersion: 1;
  readonly skills: readonly SkillManifestEntry[];
}

export interface SkillFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

export interface LoadedSkill {
  readonly entry: SkillManifestEntry;
  readonly files: readonly SkillFile[];
  readonly skillMarkdown: string;
  readonly injectedText: string;
  readonly sha256: string;
  readonly tokenCount: number;
  readonly pinnedCommitSha: string;
}

export type SecurityFindingCode =
  | "hidden_unicode"
  | "html_comment"
  | "hidden_link_title"
  | "hidden_markup"
  | "secret_path"
  | "exfiltration"
  | "verification_weaken"
  | "unapproved_payload"
  | "tool_grant"
  | "license";

export interface SecurityFinding {
  readonly code: SecurityFindingCode;
  readonly path: string;
  readonly detail: string;
}

export interface CandidateSkill {
  readonly skillId: string;
  readonly version: string;
  readonly sourceType: SkillSourceType;
  readonly license: string;
  readonly upstreamRepo: string | null;
  readonly files: readonly SkillFile[];
  readonly fromStatus: VettingStatus;
  readonly scratchParent: string;
}

export interface QuarantineReport {
  readonly skillId: string;
  readonly version: string;
  readonly fromStatus: VettingStatus;
  readonly toStatus: "vetted" | "rejected";
  readonly canaryAccesses: number;
  readonly unauthorizedNetworkCalls: number;
  readonly outOfScopeTestEdits: number;
  readonly smokePassed: boolean;
  readonly smokeDetail: string;
  readonly reasons: readonly string[];
  readonly evaluatedAt: string;
  readonly tokenCount: number;
}

export interface MountRequest {
  readonly worktreeRoot: string;
  readonly skillIds: readonly string[];
  readonly attemptId: string;
  readonly mountPath?: string;
}

export interface MountResult {
  readonly mountPath: string;
  readonly excludePath: string;
  readonly skillIds: readonly string[];
  readonly totalTokens: number;
  readonly files: readonly string[];
}

export class SkillSecurityRejection extends Error {
  readonly code = "skill_security_rejected" as const;
  readonly findings: readonly SecurityFinding[];

  constructor(findings: readonly SecurityFinding[]) {
    super(findings.map((finding) => `${finding.path}: ${finding.code}: ${finding.detail}`).join("; "));
    this.name = "SkillSecurityRejection";
    this.findings = findings;
  }
}

export class SkillHashMismatchError extends Error {
  readonly code = "sha256_mismatch" as const;

  constructor(message: string) {
    super(message);
    this.name = "SkillHashMismatchError";
  }
}

export class SkillTokenBudgetError extends Error {
  readonly code = "token_budget" as const;
  readonly tokenCount: number;
  readonly limit: number;

  constructor(message: string, tokenCount: number, limit: number) {
    super(message);
    this.name = "SkillTokenBudgetError";
    this.tokenCount = tokenCount;
    this.limit = limit;
  }
}

export class SkillManifestError extends Error {
  readonly code = "manifest" as const;

  constructor(message: string) {
    super(message);
    this.name = "SkillManifestError";
  }
}

export class SkillParityError extends Error {
  readonly code = "parity" as const;

  constructor(message: string) {
    super(message);
    this.name = "SkillParityError";
  }
}

export type SkillMountDenyCode =
  | "unvetted"
  | "revoked"
  | "rejected"
  | "outside_worktree"
  | "global_config"
  | "exclude_missing"
  | "too_many_skills"
  | "token_budget";

export class SkillMountDeniedError extends Error {
  readonly code: SkillMountDenyCode;

  constructor(code: SkillMountDenyCode, message: string) {
    super(message);
    this.name = "SkillMountDeniedError";
    this.code = code;
  }
}
