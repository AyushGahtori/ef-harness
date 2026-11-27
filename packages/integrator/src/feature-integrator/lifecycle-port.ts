import type { FeatureState } from "./constants.js";
import { verifyFeatureDoneConditions } from "./done-gate.js";
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

/** In-memory stand-in for `LifecycleRepo` until Task 022 is on the integration branch. */
export class InMemoryFeatureLifecycle implements FeatureLifecyclePort {
  private readonly rows = new Map<string, Row>();

  init(featureId: string, epoch = 0, state: FeatureState = "LEAVES_MERGED"): void {
    this.rows.set(featureId, { state, epoch });
  }

  read(featureId: string): { readonly state: FeatureState; readonly epoch: number } {
    const row = this.rows.get(featureId);
    if (!row) throw new FeatureNotReadyError(featureId, "PLANNED");
    return { state: row.state, epoch: row.epoch };
  }

  transition(input: {
    readonly featureId: string;
    readonly to: FeatureState;
    readonly expectedEpoch: number;
    readonly evidence: FeatureDoneEvidenceInput | null;
  }): { readonly state: FeatureState; readonly epoch: number } {
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
