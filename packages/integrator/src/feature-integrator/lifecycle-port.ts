import {
  bindLifecycles,
  FeatureDoneRefusedError as DbFeatureDoneRefusedError,
  FeatureNotFoundError as DbFeatureNotFoundError,
  IllegalFeatureTransitionError as DbIllegalFeatureTransitionError,
  LifecyclesStaleEpochError as DbStaleEpochError,
  isFeatureState,
  type LifecycleRepo,
  type ProjectStateDb,
} from "@ef-harness/db";
import type { FeatureState } from "./constants.js";
import { toDbFeatureDoneEvidence, verifyFeatureDoneConditions } from "./done-gate.js";
import {
  FeatureDoneRefusedError,
  FeatureNotReadyError,
  IllegalFeatureTransitionError,
  StaleEpochError,
} from "./errors.js";
import type { FeatureDoneEvidenceInput, FeatureLifecyclePort } from "./types.js";

const TRANSITIONS: Readonly<Record<FeatureState, readonly FeatureState[]>> = {
  PLANNED: ["JIT_READY", "BLOCKED", "DEFERRED", "ABANDONED"],
  JIT_READY: ["IN_WAVE", "BLOCKED", "DEFERRED", "ABANDONED"],
  IN_WAVE: ["BLOCKED", "DEFERRED", "ABANDONED"],
  LEAVES_MERGED: ["WIRED", "BLOCKED", "DEFERRED", "ABANDONED"],
  WIRED: ["JOURNEY_PASSED", "BLOCKED", "DEFERRED", "ABANDONED"],
  JOURNEY_PASSED: ["QUEUED_FOR_MERGE", "BLOCKED", "DEFERRED", "ABANDONED"],
  QUEUED_FOR_MERGE: ["MERGED", "BLOCKED", "DEFERRED", "ABANDONED"],
  MERGED: ["DONE", "REOPENED", "BLOCKED", "DEFERRED", "ABANDONED"],
  DONE: ["REOPENED"],
  BLOCKED: [
    "PLANNED",
    "JIT_READY",
    "IN_WAVE",
    "LEAVES_MERGED",
    "WIRED",
    "JOURNEY_PASSED",
    "QUEUED_FOR_MERGE",
    "MERGED",
    "DEFERRED",
    "ABANDONED",
  ],
  REOPENED: ["IN_WAVE", "BLOCKED", "DEFERRED", "ABANDONED"],
  DEFERRED: ["PLANNED", "JIT_READY", "ABANDONED"],
  ABANDONED: [],
};

interface Row {
  state: FeatureState;
  epoch: number;
}

/** Async in-memory `FeatureLifecyclePort` test stand-in. Production callers use `bindLifecycleRepo` / `bindProjectLifecycle`. */
export class InMemoryFeatureLifecycle implements FeatureLifecyclePort {
  private readonly rows = new Map<string, Row>();

  init(featureId: string, epoch = 0, state: FeatureState = "LEAVES_MERGED"): void {
    this.rows.set(featureId, { state, epoch });
  }

  async read(featureId: string): Promise<{ readonly state: FeatureState; readonly epoch: number }> {
    const row = this.rows.get(featureId);
    if (!row) throw new FeatureNotReadyError(featureId, "PLANNED");
    return { state: row.state, epoch: row.epoch };
  }

  async transition(input: {
    readonly featureId: string;
    readonly to: FeatureState;
    readonly expectedEpoch: number;
    readonly evidence: FeatureDoneEvidenceInput | null;
  }): Promise<{ readonly state: FeatureState; readonly epoch: number }> {
    const row = this.rows.get(input.featureId);
    if (!row) throw new FeatureNotReadyError(input.featureId, "PLANNED");
    if (row.epoch !== input.expectedEpoch) {
      throw new StaleEpochError(input.featureId, input.expectedEpoch, row.epoch);
    }
    const allowed = TRANSITIONS[row.state];
    if (!allowed.includes(input.to)) {
      throw new IllegalFeatureTransitionError(row.state, input.to);
    }
    if (input.to === "DONE") {
      const result = input.evidence
        ? verifyFeatureDoneConditions(input.evidence)
        : { ok: false as const, failedConditions: ["1", "2", "3", "4", "5", "6", "7"] as const };
      if (!result.ok) throw new FeatureDoneRefusedError(result);
    }
    row.state = input.to;
    return { state: row.state, epoch: row.epoch };
  }
}

export interface LifecycleBindingOptions {
  readonly nextRev?: () => number;
  readonly now?: () => number;
}

/** Binds a canonical `ProjectStateDb` + `LifecycleRepo` directly into the integrator `FeatureLifecyclePort`. */
export function bindLifecycleRepo(
  repo: LifecycleRepo,
  stateDb: ProjectStateDb,
  options: LifecycleBindingOptions = {},
): FeatureLifecyclePort {
  let revCounter = 1;
  const nextRev = options.nextRev ?? (() => {
    const row = stateDb.writer.get("SELECT COALESCE(MAX(updated_rev), 0) AS max_rev FROM feature_runtime", []) as
      | Readonly<Record<string, unknown>>
      | undefined;
    const raw = row?.max_rev;
    const stored = typeof raw === "number" ? raw : Number(raw ?? 0);
    revCounter = Math.max(revCounter, Number.isFinite(stored) ? stored + 1 : 1);
    const rev = revCounter;
    revCounter += 1;
    return rev;
  });
  const now = options.now ?? (() => Date.now());

  return {
    async read(featureId) {
      const row = stateDb.writer.get(
        "SELECT state, epoch FROM feature_runtime WHERE feature = ?",
        [featureId],
      ) as Readonly<Record<string, unknown>> | undefined;
      if (!row) throw new FeatureNotReadyError(featureId, "PLANNED");
      const rawState = String(row.state);
      if (!isFeatureState(rawState)) {
        throw new FeatureNotReadyError(featureId, "PLANNED");
      }
      return { state: rawState, epoch: Number(row.epoch) };
    },
    async transition(input) {
      try {
        const dbEvidence = input.evidence
          ? toDbFeatureDoneEvidence(input.featureId, input.evidence)
          : undefined;
        const result = repo.transitionFeatureState({
          feature: input.featureId,
          to: input.to,
          expectedEpoch: input.expectedEpoch,
          rev: nextRev(),
          now: now(),
          ...(dbEvidence !== undefined ? { evidence: dbEvidence } : {}),
        });
        return { state: result.to, epoch: result.epoch };
      } catch (error) {
        if (error instanceof DbStaleEpochError) {
          throw new StaleEpochError(
            error.details.feature,
            error.details.expectedEpoch,
            error.details.actualEpoch ?? 0,
          );
        }
        if (error instanceof DbFeatureDoneRefusedError) {
          throw new FeatureDoneRefusedError({
            ok: error.result.ok,
            failedConditions: [...error.result.failedConditions],
          });
        }
        if (error instanceof DbIllegalFeatureTransitionError) {
          const from = error.details.from && isFeatureState(error.details.from) ? error.details.from : "PLANNED";
          const to = isFeatureState(error.details.to) ? error.details.to : input.to;
          throw new IllegalFeatureTransitionError(from, to);
        }
        if (error instanceof DbFeatureNotFoundError) {
          throw new FeatureNotReadyError(input.featureId, "PLANNED");
        }
        throw error;
      }
    },
  };
}

/** Convenience wrapper that opens `LifecycleRepo` on `ProjectStateDb` via `@ef-harness/db`'s `bindLifecycles`. */
export function bindProjectLifecycle(
  stateDb: ProjectStateDb,
  options: LifecycleBindingOptions = {},
): FeatureLifecyclePort {
  return bindLifecycleRepo(bindLifecycles(stateDb), stateDb, options);
}
