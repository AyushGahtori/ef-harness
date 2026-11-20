export const READ_RESULT_TOOL = "harness.read_result" as const;
export const READ_RESULT_MAX_BYTES = 16 * 1024;
export const SUMMARY_PREVIEW_MAX_BYTES = 2 * 1024;

export const COORDINATOR_ROLE = "coordinator" as const;
export const CONTRACT_OWNER_ROLE = "contract-owner" as const;
export const USER_INBOX_ROLE = "user-inbox" as const;

export const DEFAULT_MAILBOX_TTL = {
  maxAgeMs: 15 * 60 * 1000,
  maxOwnerTurns: 3,
} as const;

export const ARTIFACT_TYPES = [
  "planner_to_worker",
  "worker_to_verifier",
  "leaf_to_feature_integrator",
  "feature_to_merge_queue",
  "worker_to_contract_owner",
  "verification_receipt",
  "integration_conflict",
  "sealed_oracle",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const MAILBOX_KINDS = [
  "ContractClarificationRequest",
  "SharedTypeAdditionRequest",
  "IntegrationConflictHandoff",
  "VerificationDispute",
] as const;

export type MailboxKind = (typeof MAILBOX_KINDS)[number];

export const COMMIT_SHA = /^[0-9a-f]{40}$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;
export const NUMERIC_PID = /^\d+$/;

export const REQUIRED_MAILBOX_FIELDS: Record<MailboxKind, readonly string[]> = {
  ContractClarificationRequest: ["requestingTaskId", "contractId", "question"],
  SharedTypeAdditionRequest: ["requestingTaskId", "contractId", "typeName"],
  IntegrationConflictHandoff: ["featureId", "conflictPaths", "summary"],
  VerificationDispute: ["taskId", "checkId", "claim"],
};

export const OPTIONAL_MAILBOX_FIELDS: Record<MailboxKind, readonly string[]> = {
  ContractClarificationRequest: ["missingField", "proposedDelta", "rationale", "urgency"],
  SharedTypeAdditionRequest: ["fields", "rationale"],
  IntegrationConflictHandoff: ["hunks"],
  VerificationDispute: ["evidenceHandoffId"],
};
