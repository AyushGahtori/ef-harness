import type { QuestionDedupSubscriberStore } from "./dedup.js";
import type { InterruptionAudit } from "./metrics.js";
import { countsAsHumanInterruption, isInternalAgentOwner } from "./priority.js";
import type { OwnerMailboxPort, OwnerResolutionPort, SettledDecisionPort } from "./ports.js";
import { assertToken } from "./text.js";
import type { FilterDisposition, WorkerQuestionRequest } from "./types.js";

export class OwnerFirstQuestionFilter {
  constructor(
    private readonly settled: SettledDecisionPort,
    private readonly owners: OwnerResolutionPort,
    private readonly mailbox: OwnerMailboxPort,
    private readonly queue: QuestionDedupSubscriberStore,
    private readonly metrics: InterruptionAudit,
  ) {}

  intercept(request: WorkerQuestionRequest): FilterDisposition {
    assertToken(request.buildId, "buildId");
    assertToken(request.waitingTaskId, "waitingTaskId");
    const started = performance.now();
    const fact = this.settled.lookup({
      text: request.text,
      ...(request.scopeId === undefined ? {} : { scopeId: request.scopeId }),
      ...(request.criterionId === undefined ? {} : { criterionId: request.criterionId }),
    });
    const lookupMs = performance.now() - started;
    if (fact) {
      this.metrics.record(request.buildId, "owner_first_intercepted");
      return {
        lane: "auto_reply",
        userInterrupted: false,
        answer: fact.answer,
        source: fact.source,
        factId: fact.factId,
        elapsedMs: lookupMs,
      };
    }
    if (request.kind === "technical" && request.contractId !== undefined) {
      const owner = this.owners.ownerOf(request.contractId);
      if (owner && isInternalAgentOwner(owner.ownerRole)) {
        const receipt = this.mailbox.submit({
          kind: "ContractClarificationRequest",
          targetRole: owner.ownerRole,
          targetOwnerTaskId: owner.ownerTaskId,
          contractId: request.contractId,
          requestingTaskId: request.waitingTaskId,
          payload: {
            requestingTaskId: request.waitingTaskId,
            contractId: request.contractId,
            question: request.text,
          },
        });
        this.metrics.record(request.buildId, "owner_first_intercepted");
        return {
          lane: "owner_mailbox",
          userInterrupted: false,
          mailboxId: receipt.mailboxId,
          targetRole: receipt.targetRole,
          targetOwnerTaskId: receipt.targetOwnerTaskId,
          elapsedMs: performance.now() - started,
        };
      }
    }
    const admitted = this.queue.admit(request);
    const collapsed = !admitted.created && admitted.newSubscriber;
    if (admitted.created && countsAsHumanInterruption(admitted.card.priority)) {
      this.metrics.record(request.buildId, "human_interruption");
    } else if (collapsed) {
      this.metrics.record(request.buildId, "duplicates_collapsed");
    }
    return {
      lane: "human_queue",
      userInterrupted: admitted.created && countsAsHumanInterruption(admitted.card.priority),
      reason: admitted.card.humanReason,
      card: admitted.card,
      collapsed,
      elapsedMs: performance.now() - started,
    };
  }
}
