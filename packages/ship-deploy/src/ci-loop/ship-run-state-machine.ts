import type { ShipRunPhase, ShipRunRecord } from "./types.js";
import type { ShipRunStore } from "./contracts.js";

const TRANSITIONS: Readonly<Record<ShipRunPhase, readonly ShipRunPhase[]>> = {
  PREFLIGHT: ["PUSH_APPROVAL", "CI_ESCALATED"],
  PUSH_APPROVAL: ["PUSHING", "CI_ESCALATED"],
  PUSHING: ["PR_OPEN", "CI_ESCALATED"],
  PR_OPEN: ["CI_WATCHING", "CI_ESCALATED"],
  CI_WATCHING: ["CI_GREEN", "CI_TRIAGING", "CI_ESCALATED"],
  CI_TRIAGING: ["CI_FIXING", "CI_ESCALATED", "CI_GREEN"],
  CI_FIXING: ["CI_WATCHING", "CI_ESCALATED", "CI_GREEN"],
  CI_GREEN: ["DEPLOYING"],
  CI_ESCALATED: ["CI_WATCHING", "CI_TRIAGING"],
  DEPLOYING: ["SHIPPED", "CI_ESCALATED"],
  SHIPPED: [],
};

function phaseToDbStatus(phase: ShipRunPhase): ShipRunRecord["status"] {
  switch (phase) {
    case "CI_GREEN":
    case "SHIPPED":
      return "passed";
    case "CI_ESCALATED":
      return "failed";
    case "PREFLIGHT":
    case "PUSH_APPROVAL":
      return "pending";
    default:
      return "running";
  }
}

export function createShipRunRecord(input: {
  readonly id: string;
  readonly feature?: string;
  readonly repo?: string;
  readonly effect?: string;
}): ShipRunRecord {
  const now = Date.now();
  return {
    id: input.id,
    kind: "pr",
    feature: input.feature ?? null,
    effect: input.effect ?? null,
    repo: input.repo ?? null,
    prNumber: null,
    headSha: null,
    runId: null,
    environment: null,
    status: "pending",
    failureFingerprint: null,
    repairGeneration: 0,
    url: null,
    phase: "PREFLIGHT",
    updatedAt: now,
    repairPushesByFingerprint: {},
    totalRepairPushes: 0,
  };
}

export class ShipRunStateMachine {
  constructor(private readonly store: ShipRunStore) {}

  load(runId: string): ShipRunRecord | undefined {
    return this.store.get(runId);
  }

  resumeAfterCrash(runId: string): { readonly record: ShipRunRecord; readonly resumedAt: ShipRunPhase } | undefined {
    const record = this.store.get(runId);
    if (!record) return undefined;
    if (record.phase === "CI_WATCHING" || record.phase === "CI_FIXING" || record.phase === "CI_TRIAGING") {
      return { record, resumedAt: record.phase };
    }
    return { record, resumedAt: record.phase };
  }

  transition(runId: string, next: ShipRunPhase, patch?: Partial<Pick<ShipRunRecord, "prNumber" | "headSha" | "runId" | "url" | "failureFingerprint">>): ShipRunRecord {
    const current = this.store.get(runId);
    if (!current) {
      throw new Error(`ship run ${runId} not found`);
    }
    const allowed = TRANSITIONS[current.phase] ?? [];
    if (current.phase !== next && !allowed.includes(next)) {
      throw new Error(`illegal ship transition ${current.phase} -> ${next}`);
    }
    const updated: ShipRunRecord = {
      ...current,
      ...patch,
      phase: next,
      status: phaseToDbStatus(next),
      updatedAt: Date.now(),
    };
    this.store.upsert(updated);
    return updated;
  }

  attachPr(runId: string, prNumber: number, url: string): ShipRunRecord {
    return this.transition(runId, "PR_OPEN", { prNumber, url });
  }

  markCiWatching(runId: string, githubRunId: string): ShipRunRecord {
    return this.transition(runId, "CI_WATCHING", { runId: githubRunId });
  }

  markCiGreen(runId: string): ShipRunRecord {
    return this.transition(runId, "CI_GREEN");
  }

  recordRepairPush(runId: string, fingerprint: string): ShipRunRecord {
    const current = this.store.get(runId);
    if (!current) {
      throw new Error(`ship run ${runId} not found`);
    }
    const count = (current.repairPushesByFingerprint[fingerprint] ?? 0) + 1;
    const updated: ShipRunRecord = {
      ...current,
      repairPushesByFingerprint: { ...current.repairPushesByFingerprint, [fingerprint]: count },
      totalRepairPushes: current.totalRepairPushes + 1,
      repairGeneration: current.repairGeneration + 1,
      failureFingerprint: fingerprint,
      updatedAt: Date.now(),
    };
    this.store.upsert(updated);
    return updated;
  }
}