import type {
  CasBlobStore,
  CoordinatorWriteQueue,
  LifecycleRepo,
  OutboxRepo,
  ProjectStateDb,
  TaskHoldAndSubmissionRepo,
} from "@ef-harness/db";
import type { RefLeaseManager } from "@ef-harness/git-engine";
import { CandidateAcceptanceCoordinator } from "./coordinator.js";
import { PAUSE_HOLD_REASON } from "./types.js";
import type { AcceptanceDecision, FinalizeCandidateAcceptanceInput } from "./types.js";
import { bindQueuedDatabase, bindWriterDatabase } from "./writer-bind.js";

const SHA256_HEX = /^[0-9a-f]{64}$/i;

export interface VerifiedCandidateRequest extends FinalizeCandidateAcceptanceInput {
  readonly opId: string;
  readonly featureRef: string;
  readonly expectedOldSha: string;
  readonly newSha: string;
  readonly refHolder: string;
  readonly refEpoch: number;
}

export interface VerifiedCandidateDeps {
  readonly stateDb: ProjectStateDb;
  readonly queue: CoordinatorWriteQueue;
  readonly holds: TaskHoldAndSubmissionRepo;
  readonly lifecycles: LifecycleRepo;
  readonly outbox: OutboxRepo;
  readonly cas: CasBlobStore;
  readonly refs: RefLeaseManager;
  readonly now?: () => number;
}

/**
 * Accept a verified candidate on `ProjectStateDb` through `CoordinatorWriteQueue`.
 * `ACCEPTED` is the schema done state. It is written only after the feature ref
 * compare-and-swap succeeds and no hard hold is active. A fencing-epoch mismatch
 * is left to the coordinator, which quarantines the late attempt.
 */
export async function acceptVerifiedCandidate(
  deps: VerifiedCandidateDeps,
  input: VerifiedCandidateRequest,
): Promise<AcceptanceDecision> {
  deps.lifecycles.listUnlockableFeatures();
  const holds = deps.holds.listActiveHolds(input.task);
  const hardHold = holds.some((hold) => hold.reason !== PAUSE_HOLD_REASON);
  if (SHA256_HEX.test(input.artifactDigest)) {
    await deps.cas.verifyBlobIntegrity(input.artifactDigest);
  }
  const clock = deps.now;
  const preview = new CandidateAcceptanceCoordinator({
    db: bindWriterDatabase(deps.stateDb.writer),
    preview: true,
    ...(clock ? { now: clock } : {}),
  });
  const looked = preview.finalizeCandidateAcceptance(input);
  let refAdvanced = false;
  if (!hardHold && looked.reason === "accepted") {
    const advanced = await deps.refs.advanceRefCas({
      ref: input.featureRef,
      newSha: input.newSha,
      expectedOldSha: input.expectedOldSha,
      holder: input.refHolder,
      epoch: input.refEpoch,
    });
    refAdvanced = advanced.ok;
  }
  const receipt = await deps.queue.submitOperation<AcceptanceDecision>({
    opId: input.opId,
    kind: "accept_submission",
    request: {
      task: input.task,
      attempt: input.attempt,
      epoch: input.epoch,
      artifactDigest: input.artifactDigest,
      featureRef: input.featureRef,
      newSha: input.newSha,
    },
    execute(tx) {
      const coordinator = new CandidateAcceptanceCoordinator({
        db: bindQueuedDatabase(deps.stateDb.writer, tx),
        ...(clock ? { now: clock } : {}),
        beforeAccept: () => {
          if (hardHold) return { ok: false, reason: "hard hold is active" };
          if (!refAdvanced) return { ok: false, reason: "feature ref compare-and-swap failed" };
          return { ok: true };
        },
      });
      return coordinator.finalizeCandidateAcceptance(input);
    },
  });
  const epoch = deps.outbox.currentStreamEpoch();
  deps.outbox.readSinceSeq(epoch, 0);
  return receipt.result;
}
