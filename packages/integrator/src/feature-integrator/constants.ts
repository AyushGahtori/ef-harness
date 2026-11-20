/** Canonical feature ref and the integration ref advanced by M2 compare-and-swap. */
export const INTEGRATION_REF = "refs/heads/harness/integration";

export const CONTEXT_RADIUS = 30;

/** Integration-fix hints stay inside two rounds. */
export const MAX_FIX_ROUNDS = 2;

export const DEFAULT_HARNESS_VERSION = "0.0.0";

export const EF_TRAILER_KEYS = [
  "EF-Feature",
  "EF-Tasks",
  "EF-Requirements",
  "EF-Checks-Passed",
  "EF-Harness-Version",
] as const;

export type EfTrailerKey = (typeof EF_TRAILER_KEYS)[number];

/** Shared registration files owned by the single feature wiring task. */
export const UI_SHARED_FILES = [
  "src/app.tsx",
  "src/routes.ts",
  "src/nav.ts",
  "src/di-container.ts",
  "src/openapi.ts",
] as const;

export const BACKEND_SHARED_FILES = [
  "src/queue-consumers.ts",
  "src/cron.ts",
  "src/health.ts",
] as const;

export const UI_SHARED_FILE_SET: ReadonlySet<string> = new Set(UI_SHARED_FILES);
export const BACKEND_SHARED_FILE_SET: ReadonlySet<string> = new Set(BACKEND_SHARED_FILES);

export const DONE_CONDITION_IDS = ["1", "2", "3", "4", "5", "6", "7"] as const;
export type DoneConditionId = (typeof DONE_CONDITION_IDS)[number];

/** Local port of the Task 077 seam catalog (S-01 through S-10). */
export const SEAM_CATALOG = [
  { id: "S-01", name: "Auth Middleware ↔ Protected API Route" },
  { id: "S-02", name: "Web Client Form/State ↔ Backend API Contract" },
  { id: "S-03", name: "Backend Service ↔ Relational DB / Migration" },
  { id: "S-04", name: "External Webhook Provider ↔ Signature Verifier & Queue" },
  { id: "S-05", name: "File Upload UI ↔ Presigned/Local Storage & Scanner" },
  { id: "S-06", name: "Transactional Email / Notification Trigger ↔ Mailer/Queue" },
  { id: "S-07", name: "Scheduled Job / Cutoff Timer ↔ Business State Mutation" },
  { id: "S-08", name: "Payment Checkout ↔ Order/Ledger Finalization" },
  { id: "S-09", name: "Cache Layer ↔ Primary Store Invalidation" },
  { id: "S-10", name: "Realtime Stream/WebSocket ↔ Client Reconnect/Resync" },
] as const;

export type SeamId = (typeof SEAM_CATALOG)[number]["id"];

export const FEATURE_STATES = [
  "PLANNED",
  "JIT_READY",
  "IN_WAVE",
  "LEAVES_MERGED",
  "WIRED",
  "JOURNEY_PASSED",
  "QUEUED_FOR_MERGE",
  "MERGED",
  "DONE",
  "BLOCKED",
  "REOPENED",
  "DEFERRED",
  "ABANDONED",
] as const;

export type FeatureState = (typeof FEATURE_STATES)[number];

export const MERGE_TREE_COMMAND = "git merge-tree --write-tree --name-only --messages";

export function featureRef(featureId: string): string {
  return `refs/heads/harness/f/${featureId}`;
}

export function seamName(id: SeamId): string {
  const found = SEAM_CATALOG.find((seam) => seam.id === id);
  return found?.name ?? id;
}

export function isSeamId(value: string): value is SeamId {
  return SEAM_CATALOG.some((seam) => seam.id === value);
}
