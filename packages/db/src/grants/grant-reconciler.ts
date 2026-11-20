import { CrossDatabasePathError, ProjectMismatchError } from "./errors.js";
import { assertSafeInteger } from "./integers.js";
import type { BrokerGrantIssuer } from "./broker-grant-issuer.js";
import type {
  CloseGrantResult,
  ClosureRecording,
  DepositAckResult,
  ExpiredGrant,
  GrantUnknownReconciledMessage,
  ReleasedGrant,
  UnknownReconciliationRecording,
} from "./messages.js";
import type { ProjectGrantReceiver } from "./project-grant-receiver.js";

export interface ProjectRestartReport {
  readonly closed: readonly CloseGrantResult[];
  readonly recorded: readonly ClosureRecording[];
  readonly released: readonly ReleasedGrant[];
  readonly acknowledged: readonly DepositAckResult[];
  readonly readyForNewGrants: boolean;
}

export class GrantReconciler {
  private readonly broker: BrokerGrantIssuer;
  private readonly receiver: ProjectGrantReceiver | null;
  private readonly projectId: string;

  constructor(broker: BrokerGrantIssuer, receiver: ProjectGrantReceiver | null, projectId: string) {
    if (receiver && receiver.projectId !== projectId) {
      throw new ProjectMismatchError(receiver.projectId, projectId);
    }
    if (receiver && broker.filePath === receiver.filePath) {
      throw new CrossDatabasePathError();
    }
    this.broker = broker;
    this.receiver = receiver;
    this.projectId = projectId;
  }

  /**
   * Scenario 1: the project crashed before depositing. It reports the grant ids
   * actually present in state.db. Issued grants missing from that list are expired
   * and their full unused capacity is returned. Deposited grants still marked
   * issued on the broker are acknowledged.
   */
  recoverUndepositedGrants(depositedGrantIds: readonly string[], now: number): {
    readonly released: readonly ReleasedGrant[];
    readonly acknowledged: readonly DepositAckResult[];
  } {
    assertSafeInteger(now, "now");
    const released = this.broker.releaseUndepositedGrants(this.projectId, depositedGrantIds, now);
    const acknowledged = this.broker.acknowledgeDepositedGrants(depositedGrantIds);
    return { released, acknowledged };
  }

  /**
   * Scenario 2: the project closed a grant and crashed before the broker ack.
   * Unreported closures (closure_reported_at IS NULL) are sent again.
   */
  resendUnreportedClosures(now: number): ClosureRecording[] {
    const receiver = this.requireReceiver();
    return this.recordUnreported(receiver, now);
  }

  /**
   * Scenario 3: the project never returns. After expires_at plus grace, every
   * still-open grant is counted as fully used.
   */
  expireVanishedProjectGrants(now: number, graceMs: number): ExpiredGrant[] {
    return this.broker.expireUnreportedGrants(now, graceMs);
  }

  /**
   * Scenario 4: a paid call was unknown at closure. unknown_units stays spent
   * until this late reconciliation arrives, and known used_units never fall.
   */
  reconcileUnknownPaidCall(message: GrantUnknownReconciledMessage): UnknownReconciliationRecording {
    const recording = this.broker.reconcileUnknownSpend(message);
    this.receiver?.recordUnknownReconciliation(message);
    return recording;
  }

  /**
   * Crash recovery for a project that came back: close expired local grants,
   * re-send unreported closures, return capacity for grants that were never
   * deposited, and keep new grants held while a closure is still waiting on
   * an in-flight reservation.
   */
  async recoverProjectRestart(now: number): Promise<ProjectRestartReport> {
    const receiver = this.requireReceiver();
    assertSafeInteger(now, "now");
    this.broker.holdNewGrants();
    const grantIds = receiver.grantsNeedingClosure(now);
    const closed: CloseGrantResult[] = [];
    for (const grantId of grantIds) {
      closed.push(await receiver.closeGrant(grantId, now, "expired"));
    }
    const recorded = this.recordUnreported(receiver, now);
    const depositedGrantIds = receiver.listDepositedGrantIds();
    const released = this.broker.releaseUndepositedGrants(this.projectId, depositedGrantIds, now);
    const acknowledged = this.broker.acknowledgeDepositedGrants(depositedGrantIds);
    const waiting = closed.some((item) => item.status === "waiting_for_held");
    const readyForNewGrants = !waiting && receiver.unreportedClosures().length === 0;
    if (readyForNewGrants) {
      this.broker.releaseNewGrants();
    }
    return { closed, recorded, released, acknowledged, readyForNewGrants };
  }

  async continueRecovery(now: number): Promise<ProjectRestartReport> {
    return this.recoverProjectRestart(now);
  }

  private recordUnreported(receiver: ProjectGrantReceiver, now: number): ClosureRecording[] {
    assertSafeInteger(now, "now");
    const reports = receiver.unreportedClosures();
    const recorded: ClosureRecording[] = [];
    for (const report of reports) {
      const recording = this.broker.recordClosure(report, now);
      receiver.markClosureReported(report.grantId, now);
      recorded.push(recording);
    }
    return recorded;
  }

  private requireReceiver(): ProjectGrantReceiver {
    if (!this.receiver) {
      throw new ProjectMismatchError(this.projectId, "missing-receiver");
    }
    return this.receiver;
  }
}
