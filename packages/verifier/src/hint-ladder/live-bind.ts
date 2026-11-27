import type { CoordinatorWriteQueue, ProjectStateDb } from "@ef-harness/db";
import type { SecretRedactor } from "@ef-harness/shared-contracts";
import { HintLadderController } from "./controller.js";
import { bindQueuedStateDb } from "./queue-db.js";
import type { StateDbPort } from "./sql.js";
import type {
  CandidateExampleRunner,
  DisputeVerdictInput,
  DisputeVerdictResult,
  HiddenCheckFailure,
  HintFeedbackPayload,
  TestDisputeInput,
  TestDisputeRecord,
} from "./types.js";

export interface PersistentHintLadderOptions {
  readonly stateDb: ProjectStateDb;
  readonly queue: CoordinatorWriteQueue;
  readonly redactor: SecretRedactor;
  readonly runner: CandidateExampleRunner;
  readonly now?: () => number;
}

/**
 * Task 065 ladder persisted on `ProjectStateDb` inside `CoordinatorWriteQueue`.
 * Hint text is passed through `SecretRedactor` before it is stored or returned.
 * Sealed example filenames and sealed expected values stay off the hint.
 */
export class PersistentHintLadder {
  private seq = 0;

  constructor(private readonly options: PersistentHintLadderOptions) {}

  processHiddenFailure(input: HiddenCheckFailure): Promise<HintFeedbackPayload> {
    const opId = `hint:${input.taskId}:${input.attemptId}:${input.checkId}:${this.next()}`;
    return this.enqueue(opId, "hint_ladder", { taskId: input.taskId, checkId: input.checkId }, (db) =>
      this.controller(db).processHiddenFailure(input),
    );
  }

  handleTestDispute(input: TestDisputeInput): Promise<TestDisputeRecord> {
    const opId = `dispute:${input.taskId}:${input.referenceId}:${this.next()}`;
    return this.enqueue(opId, "test_dispute", { taskId: input.taskId, referenceId: input.referenceId }, (db) =>
      this.controller(db).handleTestDispute(input),
    );
  }

  applyDisputeVerdict(input: DisputeVerdictInput): Promise<DisputeVerdictResult> {
    const opId = `dispute-verdict:${input.disputeId}:${this.next()}`;
    return this.enqueue(opId, "dispute_verdict", { disputeId: input.disputeId, verdict: input.verdict }, (db) =>
      this.controller(db).applyDisputeVerdict(input),
    );
  }

  private controller(db: StateDbPort): HintLadderController {
    const now = this.options.now;
    return new HintLadderController({
      db,
      runner: this.options.runner,
      redactor: this.options.redactor,
      ...(now ? { now } : {}),
    });
  }

  private enqueue<T>(opId: string, kind: string, request: unknown, body: (db: StateDbPort) => T): Promise<T> {
    const writer = this.options.stateDb.writer;
    return this.options.queue
      .submitOperation<T>({
        opId,
        kind,
        request,
        execute: (tx) => body(bindQueuedStateDb(writer, tx)),
      })
      .then((receipt) => receipt.result);
  }

  private next(): number {
    this.seq += 1;
    return this.seq;
  }
}

/** Routes test disputes through the persistent ladder and the same redactor. */
export class DisputeTestRouter {
  constructor(private readonly ladder: PersistentHintLadder) {}

  handleTestDispute(input: TestDisputeInput): Promise<TestDisputeRecord> {
    return this.ladder.handleTestDispute(input);
  }

  applyDisputeVerdict(input: DisputeVerdictInput): Promise<DisputeVerdictResult> {
    return this.ladder.applyDisputeVerdict(input);
  }
}
